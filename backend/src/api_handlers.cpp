#include "api_handlers.h"
#include "auth_service.h"
#include "node_driver_msgs/msg/SensorMsgControl.h"
#include "node_app_msgs/msg/IotCmdMsg.h"
#include "node_platform_msgs/msg/WebActionControl.h"
#include "node_control_msgs/msg/MotorConfig.h"
#include "node_system_manager/srv/ProcessControl.h"
#include "sensor_msgs/msg/Joy.h"
#include "websocket_handler.h"
#include "nav_manager.h"
#include "nav_map_io.h"
#include "view_config.h"
#include <drogon/drogon.h>
#include <drogon/utils/Utilities.h>
#include <json/json.h>
#include <robot_ai_common/base/utils.h>
#include <lyos/lyos.h>
#include <std_msgs/msg/String.h>
#include <string>
#include <thread>
#include <chrono>
#include <cmath>
#include <filesystem>
#include <algorithm>
#include <cctype>
#include <sstream>
#include <iomanip>
#include <ctime>

using namespace drogon;
using namespace robot_monitor;

namespace {

HttpResponsePtr jsonErrorResponse(const std::string& error, int status_code) {
    Json::Value json;
    json["success"] = false;
    json["error"] = error;
    auto resp = HttpResponse::newHttpJsonResponse(json);
    resp->setStatusCode(static_cast<HttpStatusCode>(status_code));
    resp->addHeader("Access-Control-Allow-Origin", "*");
    resp->addHeader("Access-Control-Allow-Methods",
                    "GET,POST,PUT,DELETE,OPTIONS");
    resp->addHeader("Access-Control-Allow-Headers",
                    "Origin,Content-Type,Accept,Authorization");
    return resp;
}

bool requireAuth(const HttpRequestPtr& req,
                 const std::function<void(const HttpResponsePtr&)>& callback,
                 AuthClaims& claims) {
    if (!AuthService::instance().parseBearer(req, claims)) {
        callback(jsonErrorResponse("Unauthorized", 401));
        return false;
    }
    return true;
}

bool endsWith(const std::string& name, const std::string& suffix) {
    return name.size() >= suffix.size() &&
           name.compare(name.size() - suffix.size(), suffix.size(), suffix) ==
               0;
}

/** 列表白名单：log *.log / *.log.active；bag *.mcap / *.mcap.active */
bool isAllowedFile(const std::string& type, const std::string& filename) {
    if (type == "log") {
        return endsWith(filename, ".log") || endsWith(filename, ".log.active");
    }
    if (type == "bag") {
        return endsWith(filename, ".mcap") ||
               endsWith(filename, ".mcap.active");
    }
    return false;
}

/** 下载白名单：log 允许 active；bag 仅 *.mcap（录制中不可下） */
bool isDownloadableFile(const std::string& type, const std::string& filename) {
    if (type == "log") {
        return endsWith(filename, ".log") || endsWith(filename, ".log.active");
    }
    if (type == "bag") {
        return endsWith(filename, ".mcap") &&
               !endsWith(filename, ".mcap.active");
    }
    return false;
}

const ViewConfig& viewCfg() {
    return ViewConfigManager::getInstance().getConfig();
}

/** log / bag 录制文件根目录，来自 roboview.yaml */
std::string recordingBaseDir(const std::string& type) {
    if (type == "log") return viewCfg().localLogsPathOrDefault();
    if (type == "bag") return viewCfg().localBagsPathOrDefault();
    return {};
}

bool requireAdmin(const AuthClaims& claims,
                  const std::function<void(const HttpResponsePtr&)>& callback) {
    if (!AuthService::roleAtLeast(claims.role, "admin")) {
        callback(jsonErrorResponse("Forbidden", 403));
        return false;
    }
    return true;
}

bool requireDeveloper(
    const AuthClaims& claims,
    const std::function<void(const HttpResponsePtr&)>& callback) {
    if (!AuthService::roleAtLeast(claims.role, "developer")) {
        callback(jsonErrorResponse("Forbidden", 403));
        return false;
    }
    return true;
}

// 等效于: robot_control restart diagnostics
bool restartDiagnosticsProcess(std::string& error_msg) {
    static constexpr const char* kProcessControlTopic =
        "/system_manager/process_control";
    static lyos::ServiceClient<node_system_manager::srv::ProcessControl_Request,
                               node_system_manager::srv::ProcessControl_Response>
        client(kProcessControlTopic);
    static bool client_registered = false;
    if (!client_registered) {
        lyos::nh()->serviceClient(client);
        client_registered = true;
    }

    // 等待服务就绪（最多约 3s），避免刚启动时 call 直接超时
    for (int i = 0; i < 30; ++i) {
        if (!lyos::nh()->ok()) {
            error_msg = "lyos node not ok";
            return false;
        }
        const std::string service_list = lyos::nh()->getServiceList();
        if (service_list.find(kProcessControlTopic) != std::string::npos) {
            break;
        }
        if (i == 29) {
            error_msg = "process_control service unavailable";
            return false;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }

    node_system_manager::srv::ProcessControl_Request req;
    req.command() = "restart";
    req.process_name() = "diagnostics";

    node_system_manager::srv::ProcessControl_Response resp;
    if (!client.call(req, resp, 20)) {
        error_msg = "process_control call timeout";
        return false;
    }
    if (!resp.success()) {
        error_msg = "process_control rejected restart diagnostics";
        return false;
    }
    return true;
}

// 与 iot_rccontroller 行走模式前置条件保持一致
bool canRobotMove(const RobotState& state, std::string& reason) {
    if (!state.connected) {
        reason = "Robot not connected";
        return false;
    }
    if (state.status != "RUNNING") {
        reason = "Robot state must be RUNNING, current: " + state.status;
        return false;
    }
    if (state.mode != "DEFAULT") {
        reason = "Robot mode must be DEFAULT, current: " + state.mode;
        return false;
    }
    if (state.action != "NONE") {
        reason = "Another action is running: " + state.action;
        return false;
    }
    if (state.running_status != "IDLE") {
        reason = "Robot is busy, running_status: " + state.running_status;
        return false;
    }
    return true;
}

// 前端以 10Hz 发送完整摇杆心跳；允许短暂抖动，但失联后必须尽快停车
constexpr auto kWebJoyCommandTimeout = std::chrono::milliseconds(300);

#ifdef PRODUCT_LRD_W
// 与 iot_rccontroller::joyToTwist 轴映射一致；限幅为 1，直接使用轴值
geometry_msgs::msg::Twist webJoyToTwist(const sensor_msgs::msg::Joy& joy) {
    geometry_msgs::msg::Twist twist;
    const auto& axes = joy.axes();

    if (axes.size() > 1) {
        twist.linear().x(static_cast<double>(axes[1]));
    }
    if (!axes.empty()) {
        twist.linear().y(static_cast<double>(axes[0]));
    }
    if (axes.size() > 2) {
        twist.angular().z(static_cast<double>(axes[2]));
    }
    return twist;
}
#endif

Json::Value mapToJson(const MapInfo& map_info) {
    Json::Value json;
    json["id"] = map_info.id;
    json["name"] = map_info.name;
    json["image_url"] = map_info.image_url;
    json["source"] = map_info.source;
    json["resolution"] = map_info.resolution;
    json["origin_x"] = map_info.origin_x;
    json["origin_y"] = map_info.origin_y;
    json["width"] = map_info.width;
    json["height"] = map_info.height;
    json["wall_thickness"] = map_info.wall_thickness;
    return json;
}

Json::Value waypointToJson(const Waypoint& waypoint) {
    Json::Value json;
    json["id"] = waypoint.id;
    json["map_id"] = waypoint.map_id;
    json["name"] = waypoint.name;
    json["x"] = waypoint.x;
    json["y"] = waypoint.y;
    json["yaw"] = waypoint.yaw;
    json["description"] = waypoint.description;
    return json;
}

Json::Value routeToJson(const NavRoute& route) {
    Json::Value json;
    json["id"] = route.id;
    json["map_id"] = route.map_id;
    json["name"] = route.name;
    json["description"] = route.description;
    Json::Value waypoint_ids(Json::arrayValue);
    for (const auto& waypoint_id : route.waypoint_ids) {
        waypoint_ids.append(waypoint_id);
    }
    json["waypoint_ids"] = waypoint_ids;
    return json;
}

/**
 * 发布 IotCmdMsg 到 /iot/command（建图 MAP / 定位 LOC 等共用懒注册）
 */
bool publishIotCommand(const std::string& category, const std::string& fun_name,
                       const std::string& param, std::string& error_out) {
    static lyos::Publisher<node_app_msgs::msg::IotCmdMsg> iot_cmd_publisher(
        "/iot/command");
    static bool publisher_advertised = false;
    if (!publisher_advertised) {
        lyos::nh()->advertise(iot_cmd_publisher, false);
        publisher_advertised = true;
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }

    node_app_msgs::msg::IotCmdMsg cmd_msg;
    cmd_msg.category() = category;
    cmd_msg.fun_name() = fun_name;
    cmd_msg.sub() = "";
    cmd_msg.param() = param;

    const int result = iot_cmd_publisher.publish(cmd_msg);
    if (result < 0) {
        error_out = "Failed to publish " + category + "/" + fun_name;
        return false;
    }
    std::cout << "[ApiController] Published /iot/command " << category << "/"
              << fun_name << " param=\"" << param << "\"" << std::endl;
    return true;
}

/** 建图/加载：category=MAP；LOAD 时 param=地图名，其余 fun 通常 param 空 */
bool publishMapIotCmd(const std::string& fun_name, const std::string& param,
                      std::string& error_out) {
    return publishIotCommand("MAP", fun_name, param, error_out);
}

/** 定位：category=LOC，主动 param 空；手动 param 为 "x,y,yaw"（真实地图坐标+朝向） */
bool publishLocIotCmd(const std::string& param, std::string& error_out) {
    return publishIotCommand("LOC", "START", param, error_out);
}

/** 导航：category=NAV，fun_name=START/PAUSE/RESUME/STOP；仅 START 带 param */
bool publishNavIotCmd(const std::string& fun_name, const std::string& param,
                      std::string& error_out) {
    return publishIotCommand("NAV", fun_name, param, error_out);
}

}  // namespace

ApiController::ApiController() {
    joy_msg_.buttons().resize(14, 0);
    joy_msg_.axes().resize(8, 0);
    joy_running_ = true;
    iot_joy_publisher_ = std::make_shared<lyos::Publisher<std_msgs::msg::Bool>>(
        "iot_joy_switch");
    lyos::nh()->advertise(*iot_joy_publisher_);
#ifdef PRODUCT_LRD_W
    // LRD-W：发布 Twist 到 /cmd_vel
    cmd_vel_publisher_ =
        std::make_shared<lyos::Publisher<geometry_msgs::msg::Twist>>("/cmd_vel");
    lyos::nh()->advertise(*cmd_vel_publisher_);
#else
    joy_publisher_ =
        std::make_shared<lyos::Publisher<sensor_msgs::msg::Joy>>("joy");
    lyos::nh()->advertise(*joy_publisher_);
#endif
    loadConfig();
    joy_thread_ = std::thread(&ApiController::joyThread, this);
}

ApiController::~ApiController() {
    joy_running_ = false;
    joy_thread_.join();
}

void ApiController::loadConfig() {
    bool iot_default = true;
    bool web_default = false;

    const std::string joy_path = viewCfg().joyConfigPathOrDefault();
    if (lyos::filesystem::exists(lyos::filesystem::path(joy_path))) {
        lyos::Param param(joy_path);
        bool iot_val = iot_default;
        bool web_val = web_default;
        param.param("iot_joy_switch", iot_val, iot_default);
        param.param("web_joy_switch", web_val, web_default);
        RobotStateManager::getInstance().updateJoyIotState(iot_val, web_val);
        publishIotJoySwitch(iot_val);
    } else {
        RobotStateManager::getInstance().updateJoyIotState(iot_default,
                                                           web_default);
        publishIotJoySwitch(iot_default);
    }
}

void ApiController::publishIotJoySwitch(bool iot_joy_switch) {
    std_msgs::msg::Bool msg;
    msg.data() = iot_joy_switch;
    iot_joy_publisher_->publish(msg);
}

void ApiController::setIotMode(bool iot_joy_switch, bool web_joy_switch) {
    bool local_iot_joy_switch, local_web_joy_swtich;
    RobotStateManager::getInstance().getJoyIotState(local_iot_joy_switch,
                                                    local_web_joy_swtich);
    RobotStateManager::getInstance().updateJoyIotState(iot_joy_switch,
                                                       web_joy_switch);
    if (!web_joy_switch) {
        // 切离网页摇杆时立即废弃网页控制租约，避免残留轴值继续输出
        std::lock_guard<std::mutex> lock(joy_mutex_);
        joy_msg_.axes()[0] = 0;
        joy_msg_.axes()[1] = 0;
        joy_msg_.axes()[2] = 0;
        joy_msg_.axes()[5] = 0;
        joy_command_active_ = false;
        joy_session_id_.clear();
        joy_last_sequence_ = 0;
    }

    lyos::Param param(viewCfg().joyConfigPathOrDefault());
    param.set("iot_joy_switch", iot_joy_switch);
    param.set("web_joy_switch", web_joy_switch);

    if (local_iot_joy_switch != iot_joy_switch) {
        publishIotJoySwitch(iot_joy_switch);
    }

    std::cout << "[ApiController] Input mode: iot_joy_switch="
              << (iot_joy_switch ? "true" : "false")
              << " web_joy_switch=" << (web_joy_switch ? "true" : "false")
              << std::endl;
}

void ApiController::getInputMode(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    try {
        AuthClaims claims;
        if (!requireAuth(req, callback, claims)) return;

        Json::Value json;
        bool iot_joy_switch = true;
        bool web_joy_switch = false;
        RobotStateManager::getInstance().getJoyIotState(iot_joy_switch,
                                                        web_joy_switch);
        json["success"] = true;
        json["iot_joy_switch"] = iot_joy_switch;
        json["web_joy_switch"] = web_joy_switch;

        auto resp = HttpResponse::newHttpJsonResponse(json);
        resp->setStatusCode(k200OK);
        resp->addHeader("Access-Control-Allow-Origin", "*");
        callback(resp);
    } catch (const std::exception& e) {
        std::cerr << "[ApiController] Error in getInputMode: " << e.what()
                  << std::endl;
        callback(createErrorResponse(
            "Failed to get input mode: " + std::string(e.what()), 500));
    }
}

void ApiController::setInputMode(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    try {
        AuthClaims claims;
        if (!requireAuth(req, callback, claims)) return;

        Json::Value json;
        Json::CharReaderBuilder readerBuilder;
        std::string errors;
        const std::string body = std::string(req->getBody());
        std::unique_ptr<Json::CharReader> reader(readerBuilder.newCharReader());

        if (!reader->parse(body.c_str(), body.c_str() + body.length(), &json,
                           &errors)) {
            callback(createErrorResponse("Invalid JSON: " + errors));
            return;
        }

        if (!json.isMember("iot_joy_switch") ||
            !json.isMember("web_joy_switch")) {
            callback(createErrorResponse(
                "Missing required fields: iot_joy_switch, web_joy_switch"));
            return;
        }

        if (!json["iot_joy_switch"].isBool() ||
            !json["web_joy_switch"].isBool()) {
            callback(createErrorResponse(
                "iot_joy_switch and web_joy_switch must be boolean"));
            return;
        }

        const bool iot_switch = json["iot_joy_switch"].asBool();
        const bool web_switch = json["web_joy_switch"].asBool();
        if (iot_switch && web_switch) {
            callback(createErrorResponse(
                "iot_joy_switch and web_joy_switch cannot both be true", 409));
            return;
        }

        setIotMode(iot_switch, web_switch);
        callback(createSuccessResponse("Input mode updated"));
    } catch (const std::exception& e) {
        std::cerr << "[ApiController] Error in setInputMode: " << e.what()
                  << std::endl;
        callback(createErrorResponse(
            "Failed to set input mode: " + std::string(e.what()), 500));
    }
}

void ApiController::playVoiceTts(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    try {
        AuthClaims claims;
        if (!requireAuth(req, callback, claims)) return;

        Json::Value json;
        Json::CharReaderBuilder readerBuilder;
        std::string errors;
        const std::string body = std::string(req->getBody());
        std::unique_ptr<Json::CharReader> reader(readerBuilder.newCharReader());

        if (!reader->parse(body.c_str(), body.c_str() + body.length(), &json,
                           &errors)) {
            callback(createErrorResponse("Invalid JSON: " + errors));
            return;
        }

        std::string text;
        if (json.isMember("preset")) {
            const std::string preset = json["preset"].asString();
            if (preset == "welcome1") {
                text = "客户欢迎词1";
            } else if (preset == "welcome2") {
                text = "客户欢迎词2";
            } else {
                callback(createErrorResponse("Unknown preset: " + preset));
                return;
            }
        } else if (json.isMember("text")) {
            text = json["text"].asString();
            if (text.empty()) {
                callback(createErrorResponse("text cannot be empty"));
                return;
            }
        } else {
            callback(
                createErrorResponse("Missing required field: preset or text"));
            return;
        }

        const bool interrupt =
            !json.isMember("interrupt") || json["interrupt"].asBool();

        static lyos::Publisher<node_voice_msgs::msg::VoiceTts>
            voice_tts_publisher("/voice/tts");
        static bool publisher_advertised = false;
        if (!publisher_advertised) {
            lyos::nh()->advertise(voice_tts_publisher, false);
            publisher_advertised = true;
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }

        node_voice_msgs::msg::VoiceTts tts_msg;
        tts_msg.header().stamp() = lyos::Time::toMsg(lyos::Time::now());
        tts_msg.text(text);
        tts_msg.params(interrupt ? 1 : 0);

        const int result = voice_tts_publisher.publish(tts_msg);
        if (result >= 0) {
            std::cout << "[ApiController] Published voice TTS: " << text
                      << std::endl;
            callback(createSuccessResponse("Voice TTS sent: " + text));
        } else {
            callback(createErrorResponse("Failed to publish voice TTS", 500));
        }
    } catch (const std::exception& e) {
        std::cerr << "[ApiController] Error in playVoiceTts: " << e.what()
                  << std::endl;
        callback(createErrorResponse(
            "Failed to play voice TTS: " + std::string(e.what()), 500));
    }
}

void ApiController::joyThread() {
    while (joy_running_) {
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
        RobotState state = RobotStateManager::getInstance().getState();
        std::string reject_reason;
        bool web_joy_switch, iot_joy_switch;
        RobotStateManager::getInstance().getJoyIotState(iot_joy_switch,
                                                        web_joy_switch);
        if (!web_joy_switch) {
            continue;
        }
        if (!canRobotMove(state, reject_reason)) {
            continue;
        }
        sensor_msgs::msg::Joy joy_msg;
        {
            std::lock_guard<std::mutex> lock(joy_mutex_);
            const auto now = std::chrono::steady_clock::now();
            if (joy_command_active_ &&
                now - joy_last_command_time_ > kWebJoyCommandTimeout) {
                // 网络中断、浏览器崩溃或停止包丢失时的最终保护：整包归零
                joy_msg_.axes()[0] = 0;
                joy_msg_.axes()[1] = 0;
                joy_msg_.axes()[2] = 0;
                joy_msg_.axes()[5] = 0;
                joy_command_active_ = false;
                std::cerr << "[ApiController] Web joystick watchdog timeout; "
                             "command cleared"
                          << std::endl;
            }
            joy_msg = joy_msg_;
        }
#ifdef PRODUCT_LRD_W
        // LRD-W：Joy 轴 → Twist，与 iot_rccontroller 映射一致（限幅=1）
        if (!cmd_vel_publisher_) {
            continue;
        }
        geometry_msgs::msg::Twist twist = webJoyToTwist(joy_msg);
        cmd_vel_publisher_->publish(twist);
#else
        joy_msg.header().stamp(lyos::Time::toMsg(lyos::Time::now()));
        joy_msg.header().frame_id() = "joy";
        joy_publisher_->publish(joy_msg);
#endif
    }
}

Json::Value ApiController::stateToJson(const RobotState& state) {
    // Json::Value json;
    // json["battery"] = state.battery;
    // json["voltage"] = state.voltage;
    // json["status"] = state.status;
    // json["mode"] = state.mode;

    // Json::Value joints(Json::arrayValue);
    // for (const auto& joint : state.joints) {
    //     Json::Value j;
    //     j["id"] = joint.id;
    //     j["name"] = joint.name;
    //     j["temperature"] = joint.temperature;
    //     j["angle"] = joint.angle;
    //     j["status"] = joint.status;

    //     joints.append(j);
    // }
    // json["joints"] = joints;

    // Json::Value position;
    // position["x"] = state.position.x;
    // position["y"] = state.position.y;
    // position["theta"] = state.position.theta;
    // json["position"] = position;

    return Json::Value();
}

HttpResponsePtr ApiController::createSuccessResponse(
    const std::string& message) {
    Json::Value json;
    json["success"] = true;
    json["message"] = message;

    auto resp = HttpResponse::newHttpJsonResponse(json);
    resp->setStatusCode(k200OK);
    resp->addHeader("Access-Control-Allow-Origin", "*");
    resp->addHeader("Access-Control-Allow-Methods",
                    "GET,POST,PUT,DELETE,OPTIONS");
    resp->addHeader("Access-Control-Allow-Headers",
                    "Origin,Content-Type,Accept,Authorization");
    return resp;
}

HttpResponsePtr ApiController::createErrorResponse(const std::string& error,
                                                   int status_code) {
    Json::Value json;
    json["success"] = false;
    json["error"] = error;

    auto resp = HttpResponse::newHttpJsonResponse(json);
    resp->setStatusCode(static_cast<HttpStatusCode>(status_code));
    resp->addHeader("Access-Control-Allow-Origin", "*");
    resp->addHeader("Access-Control-Allow-Methods",
                    "GET,POST,PUT,DELETE,OPTIONS");
    resp->addHeader("Access-Control-Allow-Headers",
                    "Origin,Content-Type,Accept,Authorization");
    return resp;
}

void ApiController::authLogin(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    try {
        const std::string body = std::string(req->getBody());
        Json::Value json;
        Json::CharReaderBuilder readerBuilder;
        std::string errors;
        const std::unique_ptr<Json::CharReader> reader(
            readerBuilder.newCharReader());
        if (!reader->parse(body.c_str(), body.c_str() + body.length(), &json,
                           &errors)) {
            callback(createErrorResponse("Invalid JSON: " + errors, 400));
            return;
        }
        if (!json.isMember("username") || !json["username"].isString() ||
            !json.isMember("password") || !json["password"].isString()) {
            callback(createErrorResponse("Missing username or password", 400));
            return;
        }
        const std::string username = json["username"].asString();
        const std::string password = json["password"].asString();
        std::string jwt;
        int64_t exp = 0;
        std::string role;
        if (!AuthService::instance().issueToken(username, password, jwt, exp,
                                                role)) {
            callback(jsonErrorResponse("Invalid username or password", 401));
            return;
        }
        Json::Value ok;
        ok["success"] = true;
        ok["token"] = jwt;
        ok["expires_at"] = static_cast<Json::Int64>(exp);
        ok["user"]["username"] = username;
        ok["user"]["role"] = role;
        auto resp = HttpResponse::newHttpJsonResponse(ok);
        resp->setStatusCode(k200OK);
        resp->addHeader("Access-Control-Allow-Origin", "*");
        resp->addHeader("Access-Control-Allow-Methods",
                        "GET,POST,PUT,DELETE,OPTIONS");
        resp->addHeader("Access-Control-Allow-Headers",
                        "Origin,Content-Type,Accept,Authorization");
        callback(resp);
    } catch (const std::exception& e) {
        callback(
            createErrorResponse(std::string("Login failed: ") + e.what(), 500));
    }
}

void ApiController::authMe(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    AuthClaims claims;
    if (!requireAuth(req, callback, claims)) return;
    Json::Value ok;
    ok["success"] = true;
    ok["username"] = claims.username;
    ok["role"] = claims.role;
    auto resp = HttpResponse::newHttpJsonResponse(ok);
    resp->setStatusCode(k200OK);
    resp->addHeader("Access-Control-Allow-Origin", "*");
    resp->addHeader("Access-Control-Allow-Methods",
                    "GET,POST,PUT,DELETE,OPTIONS");
    resp->addHeader("Access-Control-Allow-Headers",
                    "Origin,Content-Type,Accept,Authorization");
    callback(resp);
}

void ApiController::handleAuthOptions(
    const HttpRequestPtr& /*req*/,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    auto resp = HttpResponse::newHttpResponse();
    resp->setStatusCode(k200OK);
    resp->addHeader("Access-Control-Allow-Origin", "*");
    resp->addHeader("Access-Control-Allow-Methods",
                    "GET,POST,PUT,DELETE,OPTIONS");
    resp->addHeader("Access-Control-Allow-Headers",
                    "Origin,Content-Type,Accept,Authorization");
    callback(resp);
}

// 预留接口
void ApiController::getStatus(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    AuthClaims claims;
    if (!requireAuth(req, callback, claims)) return;
    // auto& stateManager = RobotStateManager::getInstance();
    // RobotState state = stateManager.getState();

    // Json::Value json = stateToJson(state);
    // auto resp = HttpResponse::newHttpJsonResponse(json);
    // resp->setStatusCode(k200OK);
    // callback(resp);
}

// 预留控制接口
void ApiController::startRobot(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    AuthClaims claims;
    if (!requireAuth(req, callback, claims)) return;
    auto& stateManager = RobotStateManager::getInstance();
    stateManager.setStatus("running");

    // 广播状态更新
    RobotState state = stateManager.getState();
    Json::Value json_state;
    json_state["connected"] = state.connected;
    if (state.connected) {
        json_state["status"] = state.status;
        json_state["mode"] = state.mode;
        json_state["action"] = state.action;
        json_state["running_status"] = state.running_status;
    }
    // Json::Value joints(Json::arrayValue);
    // for (const auto& joint : state.joints) {
    //     Json::Value j;
    //     j["id"] = joint.id;
    //     j["name"] = joint.name;
    //     j["temperature"] = joint.temperature;
    //     j["angle"] = joint.angle;
    //     j["status"] = joint.status;
    //     joints.append(j);
    // }
    // json_state["joints"] = joints;
    WebSocketHandler::broadcastMessage("robot_state", json_state);

    callback(createSuccessResponse("Robot started"));
}

void ApiController::stopRobot(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    AuthClaims claims;
    if (!requireAuth(req, callback, claims)) return;
    auto& stateManager = RobotStateManager::getInstance();
    stateManager.setStatus("idle");

    // 广播状态更新
    RobotState state = stateManager.getState();
    Json::Value json_state;
    json_state["connected"] = state.connected;
    if (state.connected) {
        json_state["status"] = state.status;
        json_state["mode"] = state.mode;
        json_state["action"] = state.action;
        json_state["running_status"] = state.running_status;
    }
    // Json::Value joints(Json::arrayValue);
    // for (const auto& joint : state.joints) {
    //     Json::Value j;
    //     j["id"] = joint.id;
    //     j["name"] = joint.name;
    //     j["temperature"] = joint.temperature;
    //     j["angle"] = joint.angle;
    //     j["status"] = joint.status;
    //     joints.append(j);
    // }
    // json_state["joints"] = joints;
    WebSocketHandler::broadcastMessage("robot_state", json_state);

    callback(createSuccessResponse("Robot stopped"));
}

void ApiController::resetRobot(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    AuthClaims claims;
    if (!requireAuth(req, callback, claims)) return;
    auto& stateManager = RobotStateManager::getInstance();
    stateManager.reset();

    // 广播状态更新
    RobotState state = stateManager.getState();
    Json::Value json_state;
    json_state["connected"] = state.connected;
    if (state.connected) {
        json_state["status"] = state.status;
        json_state["mode"] = state.mode;
        json_state["action"] = state.action;
        json_state["running_status"] = state.running_status;
    }
    // Json::Value joints(Json::arrayValue);
    // for (const auto& joint : state.joints) {
    //     Json::Value j;
    //     j["id"] = joint.id;
    //     j["name"] = joint.name;
    //     j["temperature"] = joint.temperature;
    //     j["angle"] = joint.angle;
    //     j["status"] = joint.status;
    //     joints.append(j);
    // }
    // json_state["joints"] = joints;
    WebSocketHandler::broadcastMessage("robot_state", json_state);

    callback(createSuccessResponse("Robot reset"));
}

void ApiController::getSystemInfo(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    AuthClaims claims;
    if (!requireAuth(req, callback, claims)) return;
    try {
        ai_common::base::SystemInfo system_info;
        ai_common::base::getSystemInfo(system_info);

        Json::Value json;
        json["product"] =
            system_info.product.empty() ? "Unknown" : system_info.product;
        json["platform"] =
            system_info.platform.empty() ? "Unknown" : system_info.platform;
        json["robot_type"] =
            system_info.robot_type.empty() ? "Unknown" : system_info.robot_type;
        json["system_version"] = system_info.system_version.empty()
                                     ? "Unknown"
                                     : system_info.system_version;
        json["app_version"] = system_info.app_version.empty()
                                  ? "Unknown"
                                  : system_info.app_version;
        json["power_version"] = system_info.power_sw_version.empty()
                                    ? "Unknown"
                                    : system_info.power_sw_version;
        if (system_info.motor_info.size() >= 1) {
            json["motor_version"] = system_info.motor_info[0].sw_version.empty()
                                        ? "Unknown"
                                        : system_info.motor_info[0].sw_version;
        } else {
            json["motor_version"] = "Unknown";
        }

        auto resp = HttpResponse::newHttpJsonResponse(json);
        resp->setStatusCode(k200OK);
        callback(resp);
    } catch (const std::exception& e) {
        std::cerr << "[ApiController] Error getting system info: " << e.what()
                  << std::endl;
        callback(createErrorResponse(
            "Failed to get system info: " + std::string(e.what()), 500));
    }
}

void ApiController::controlImu(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback,
    const std::string& action) {
    try {
        AuthClaims claims;
        if (!requireAuth(req, callback, claims)) return;
        if (action != "start" && action != "stop") {
            callback(createErrorResponse(
                "Invalid action. Must be 'start' or 'stop'", 400));
            return;
        }
        // 创建 Lyos Publisher 发布 IMU 控制消息
        static lyos::Publisher<node_driver_msgs::msg::SensorMsgControl>
            imu_control_publisher("/sensor/control");
        static bool publisher_advertised = false;

        if (!publisher_advertised) {
            lyos::nh()->advertise(imu_control_publisher, false);
            publisher_advertised = true;
            std::this_thread::sleep_for(
                std::chrono::milliseconds(100));  // 等待发布者就绪
        }

        // 发布控制消息到机器
        node_driver_msgs::msg::SensorMsgControl control_msg;
        control_msg.sensor_type() = 0;  // 0：IMU
        control_msg.control_command() =
            action == "start" ? 1 : 0;  // 1: start, 0: stop

        int publish_result = imu_control_publisher.publish(control_msg);
        if (publish_result >= 0) {
            std::cout << "[ApiController] Published IMU control: " << action
                      << std::endl;
            callback(createSuccessResponse("IMU " + action + " command sent"));
        } else {
            callback(createErrorResponse(
                "Failed to publish IMU control message", 500));
        }
    } catch (const std::exception& e) {
        std::cerr << "[ApiController] Error controlling IMU: " << e.what()
                  << std::endl;
        callback(createErrorResponse(
            "Failed to control IMU: " + std::string(e.what()), 500));
    }
}

void ApiController::handleOptions(
    const HttpRequestPtr& /*req*/,
    std::function<void(const HttpResponsePtr&)>&& callback,
    const std::string& /*action*/) {
    auto resp = HttpResponse::newHttpResponse();
    resp->setStatusCode(k200OK);
    resp->addHeader("Access-Control-Allow-Origin", "*");
    resp->addHeader("Access-Control-Allow-Methods",
                    "GET,POST,PUT,DELETE,OPTIONS");
    resp->addHeader("Access-Control-Allow-Headers",
                    "Origin,Content-Type,Accept,Authorization");
    callback(resp);
}

void ApiController::setRobotState(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    std::cout << "[ApiController] setRobotState called" << std::endl;
    try {
        AuthClaims claims;
        if (!requireAuth(req, callback, claims)) return;
        std::string body = std::string(req->getBody());
        std::cout << "[ApiController] Request body: " << body << std::endl;

        Json::Value json;
        Json::CharReaderBuilder readerBuilder;
        std::string errors;
        std::unique_ptr<Json::CharReader> reader(readerBuilder.newCharReader());

        if (!reader->parse(body.c_str(), body.c_str() + body.length(), &json,
                           &errors)) {
            std::cerr << "[ApiController] JSON parse error: " << errors
                      << std::endl;
            callback(createErrorResponse("Invalid JSON: " + errors));
            return;
        }

        if (!json.isMember("state")) {
            std::cerr << "[ApiController] Missing required field: state"
                      << std::endl;
            callback(createErrorResponse("Missing required field: state"));
            return;
        }

        std::string state = json["state"].asString();
        std::cout << "[ApiController] Received state: " << state << std::endl;

        // 创建发布者
        static lyos::Publisher<node_app_msgs::msg::IotCmdMsg>
            state_cmd_publisher("/iot/command");
        static bool publisher_advertised = false;
        if (!publisher_advertised) {
            lyos::nh()->advertise(state_cmd_publisher, false);
            publisher_advertised = true;
            std::this_thread::sleep_for(
                std::chrono::milliseconds(100));  // 等待发布者就绪
        }

        // 创建消息
        node_app_msgs::msg::IotCmdMsg cmd_msg;
        cmd_msg.category() = "STATE";
        cmd_msg.fun_name() = state;
        cmd_msg.param() = "";
        cmd_msg.sub() = state;

        // 发布消息
        int result = state_cmd_publisher.publish(cmd_msg);
        if (result >= 0) {
            std::cout << "[ApiController] Published state command: " << state
                      << std::endl;
            callback(createSuccessResponse("State command sent: " + state));
        } else {
            callback(
                createErrorResponse("Failed to publish state command", 500));
        }
    } catch (const std::exception& e) {
        std::cerr << "[ApiController] Error in setRobotState: " << e.what()
                  << std::endl;
        callback(createErrorResponse(
            "Failed to set robot state: " + std::string(e.what()), 500));
    }
}

void ApiController::setRobotMode(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    std::cout << "[ApiController] setRobotMode called" << std::endl;
    try {
        AuthClaims claims;
        if (!requireAuth(req, callback, claims)) return;
        std::string body = std::string(req->getBody());
        std::cout << "[ApiController] Request body: " << body << std::endl;

        Json::Value json;
        Json::CharReaderBuilder readerBuilder;
        std::string errors;
        std::unique_ptr<Json::CharReader> reader(readerBuilder.newCharReader());

        if (!reader->parse(body.c_str(), body.c_str() + body.length(), &json,
                           &errors)) {
            std::cerr << "[ApiController] JSON parse error: " << errors
                      << std::endl;
            callback(createErrorResponse("Invalid JSON: " + errors));
            return;
        }

        if (!json.isMember("mode")) {
            std::cerr << "[ApiController] Missing required field: mode"
                      << std::endl;
            callback(createErrorResponse("Missing required field: mode"));
            return;
        }

        std::string mode = json["mode"].asString();
        std::cout << "[ApiController] Received mode: " << mode << std::endl;

        // 创建发布者
        static lyos::Publisher<node_app_msgs::msg::IotCmdMsg>
            mode_cmd_publisher("/iot/command");
        static bool publisher_advertised = false;
        if (!publisher_advertised) {
            lyos::nh()->advertise(mode_cmd_publisher, false);
            publisher_advertised = true;
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }

        // 创建消息
        node_app_msgs::msg::IotCmdMsg cmd_msg;
        cmd_msg.category() = "MODE";
        cmd_msg.fun_name() = mode;
        cmd_msg.param() = "";
        cmd_msg.sub() = mode;

        // 发布消息
        int result = mode_cmd_publisher.publish(cmd_msg);
        if (result >= 0) {
            std::cout << "[ApiController] Published mode command: " << mode
                      << std::endl;
            callback(createSuccessResponse("Mode command sent: " + mode));
        } else {
            callback(
                createErrorResponse("Failed to publish mode command", 500));
        }
    } catch (const std::exception& e) {
        std::cerr << "[ApiController] Error in setRobotMode: " << e.what()
                  << std::endl;
        callback(createErrorResponse(
            "Failed to set robot mode: " + std::string(e.what()), 500));
    }
}

void ApiController::setRobotAction(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    std::cout << "[ApiController] setRobotAction called" << std::endl;
    try {
        AuthClaims claims;
        if (!requireAuth(req, callback, claims)) return;
        std::string body = std::string(req->getBody());
        std::cout << "[ApiController] Request body: " << body << std::endl;

        Json::Value json;
        Json::CharReaderBuilder readerBuilder;
        std::string errors;
        std::unique_ptr<Json::CharReader> reader(readerBuilder.newCharReader());

        if (!reader->parse(body.c_str(), body.c_str() + body.length(), &json,
                           &errors)) {
            std::cerr << "[ApiController] JSON parse error: " << errors
                      << std::endl;
            callback(createErrorResponse("Invalid JSON: " + errors));
            return;
        }

        if (!json.isMember("action")) {
            std::cerr << "[ApiController] Missing required field: action"
                      << std::endl;
            callback(createErrorResponse("Missing required field: action"));
            return;
        }

        std::string action = json["action"].asString();
        std::cout << "[ApiController] Received action: " << action << std::endl;

        // 创建发布者
        static lyos::Publisher<node_app_msgs::msg::IotCmdMsg>
            action_cmd_publisher("/iot/command");
        static bool publisher_advertised = false;
        if (!publisher_advertised) {
            lyos::nh()->advertise(action_cmd_publisher, false);
            publisher_advertised = true;
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }

        // 创建消息
        node_app_msgs::msg::IotCmdMsg cmd_msg;
        cmd_msg.category() = "ACTION";
        cmd_msg.fun_name() = "DEFAULT";
        cmd_msg.param() = "";
        cmd_msg.sub() = action;

        // 发布消息
        int result = action_cmd_publisher.publish(cmd_msg);
        if (result >= 0) {
            std::cout << "[ApiController] Published action command: " << action
                      << std::endl;
            callback(createSuccessResponse("Action command sent: " + action));
        } else {
            callback(
                createErrorResponse("Failed to publish action command", 500));
        }
    } catch (const std::exception& e) {
        std::cerr << "[ApiController] Error in setRobotAction: " << e.what()
                  << std::endl;
        callback(createErrorResponse(
            "Failed to set robot action: " + std::string(e.what()), 500));
    }
}

void ApiController::setRobotJoy(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    try {
        AuthClaims claims;
        if (!requireAuth(req, callback, claims)) return;
        bool iot_joy_switch, web_joy_switch;
        RobotStateManager::getInstance().getJoyIotState(iot_joy_switch,
                                                        web_joy_switch);
        if (!web_joy_switch) {
            callback(
                createErrorResponse("Web joystick control is disabled", 409));
            return;
        }
        Json::Value json;
        Json::CharReaderBuilder readerBuilder;
        std::string errors;
        std::string body = std::string(req->getBody());
        std::unique_ptr<Json::CharReader> reader(readerBuilder.newCharReader());

        if (!reader->parse(body.c_str(), body.c_str() + body.length(), &json,
                           &errors)) {
            callback(createErrorResponse("Invalid JSON: " + errors));
            return;
        }

        if (!json.isMember("move") || !json.isMember("turn") ||
            !json.isMember("session_id") || !json.isMember("seq")) {
            callback(createErrorResponse(
                "Missing required fields: move, turn, session_id and seq"));
            return;
        }

        const Json::Value& move = json["move"];
        const Json::Value& turn = json["turn"];
        if (!move.isObject() || !turn.isObject() || !move.isMember("x") ||
            !move.isMember("y") || !turn.isMember("x") ||
            !turn.isMember("y") || !json["session_id"].isString() ||
            !json["seq"].isUInt64()) {
            callback(createErrorResponse("Invalid joystick command payload"));
            return;
        }

        const std::string session_id = json["session_id"].asString();
        const Json::UInt64 sequence = json["seq"].asUInt64();
        const double move_x = move["x"].asDouble();
        const double move_y = move["y"].asDouble();
        const double turn_x = turn["x"].asDouble();
        const double turn_y = turn["y"].asDouble();
        if (session_id.empty() || !std::isfinite(move_x) ||
            !std::isfinite(move_y) || !std::isfinite(turn_x) ||
            !std::isfinite(turn_y) || std::abs(move_x) > 1.0 ||
            std::abs(move_y) > 1.0 || std::abs(turn_x) > 1.0 ||
            std::abs(turn_y) > 1.0) {
            callback(createErrorResponse(
                "Joystick axes must be finite values in [-1, 1]"));
            return;
        }

        {
            std::lock_guard<std::mutex> lock(joy_mutex_);
            const auto now = std::chrono::steady_clock::now();
            const bool session_expired =
                !joy_command_active_ ||
                now - joy_last_command_time_ > kWebJoyCommandTimeout;
            bool is_new_session = false;
            if (session_id != joy_session_id_) {
                if (joy_command_active_ && !session_expired) {
                    callback(createErrorResponse(
                        "Another web joystick session is active", 409));
                    return;
                }
                joy_session_id_ = session_id;
                joy_last_sequence_ = 0;
                is_new_session = true;
            }
            if (session_expired && !is_new_session) {
                // 超时会话的迟到包不得重新激活控制，客户端必须换新 session 后续租
                callback(createErrorResponse(
                    "Joystick session expired; create a new session", 409));
                return;
            }
            if (sequence <= joy_last_sequence_) {
                callback(createErrorResponse("Stale joystick sequence", 409));
                return;
            }

            // 以单个互斥锁原子写入完整摇杆，避免 move/turn 半帧混合
            joy_msg_.axes()[0] = move_y;
            joy_msg_.axes()[1] = move_x;
            joy_msg_.axes()[2] = turn_y;
            joy_msg_.axes()[5] = turn_x;
            joy_last_sequence_ = sequence;
            joy_last_command_time_ = now;
            joy_command_active_ = true;
        }

        // 实际发布由 joyThread 周期完成（LRS-X:/joy，LRD-W:cmd_vel）
        callback(createSuccessResponse("Joystick command accepted"));
    } catch (const std::exception& e) {
        std::cerr << "[ApiController] Error in setRobotJoy: " << e.what()
                  << std::endl;
        callback(createErrorResponse(
            "Failed to set joystick command: " + std::string(e.what()), 500));
    }
}

// 列出运动脚本：扫描 action_script_path 配置目录下的文件
void ApiController::listMotionScripts(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    try {
        AuthClaims claims;
        if (!requireAuth(req, callback, claims)) return;
        const std::string base_dir = viewCfg().actionScriptPathOrDefault();

        Json::Value json;
        json["success"] = true;
        Json::Value files(Json::arrayValue);

        if (std::filesystem::exists(base_dir) &&
            std::filesystem::is_directory(base_dir)) {
            for (const auto& entry :
                 std::filesystem::directory_iterator(base_dir)) {
                if (!entry.is_regular_file()) {
                    continue;
                }
                auto path = entry.path();
                auto ext = path.extension().string();
                if (ext != ".yaml" && ext != ".yml") {
                    continue;
                }
                Json::Value item;
                item["name"] = path.filename().string();
                files.append(item);
            }
        } else {
            std::cerr << "[ApiController] Script directory not found: "
                      << base_dir << std::endl;
        }

        json["scripts"] = files;

        auto resp = HttpResponse::newHttpJsonResponse(json);
        resp->setStatusCode(k200OK);
        callback(resp);
    } catch (const std::exception& e) {
        std::cerr << "[ApiController] Error listing motion scripts: "
                  << e.what() << std::endl;
        callback(createErrorResponse(
            "Failed to list motion scripts: " + std::string(e.what()), 500));
    }
}

// 执行动作脚本：action_name + flag(1=开始,0=停止)
void ApiController::executeMotionScript(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    try {
        AuthClaims claims;
        if (!requireAuth(req, callback, claims)) return;
        std::string body = std::string(req->getBody());

        Json::Value json;
        Json::CharReaderBuilder readerBuilder;
        std::string errors;
        std::unique_ptr<Json::CharReader> reader(readerBuilder.newCharReader());

        if (!reader->parse(body.c_str(), body.c_str() + body.length(), &json,
                           &errors)) {
            callback(createErrorResponse("Invalid JSON: " + errors));
            return;
        }

        if (!json.isMember("action_name") || !json.isMember("flag")) {
            callback(createErrorResponse(
                "Missing required fields: action_name, flag"));
            return;
        }

        std::string action_name = json["action_name"].asString();

        // flag 字段兼容 int/uint8 类型，避免直接 asInt()
        // 可能导致的越界/负数问题
        int flag = json["flag"].asInt();
        if (flag != 0 && flag != 1) {
            callback(createErrorResponse("flag must be 0 or 1"));
            return;
        }

        // 通过 WebActionControl 发给底层动作播放器
        static lyos::Publisher<node_platform_msgs::msg::WebActionControl>
            script_cmd_publisher("/web/action_player");
        static bool publisher_advertised = false;
        if (!publisher_advertised) {
            lyos::nh()->advertise(script_cmd_publisher, false);
            publisher_advertised = true;
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }

        node_platform_msgs::msg::WebActionControl cmd_msg;
        cmd_msg.action_name() = action_name;          // 动作/脚本文件名
        cmd_msg.flag() = static_cast<uint8_t>(flag);  // 1: 开始, 0: 停止

        int result = script_cmd_publisher.publish(cmd_msg);
        if (result >= 0) {
            std::cout << "[ApiController] Published script command: "
                      << action_name << ", flag=" << flag
                      << (flag == 1 ? " (start)" : " (stop)") << std::endl;
            callback(
                createSuccessResponse("Script command sent: " + action_name));
        } else {
            callback(
                createErrorResponse("Failed to publish script command", 500));
        }
    } catch (const std::exception& e) {
        std::cerr << "[ApiController] Error in executeMotionScript: "
                  << e.what() << std::endl;
        callback(createErrorResponse(
            "Failed to execute motion script: " + std::string(e.what()), 500));
    }
}

void ApiController::handleControlOptions(
    const HttpRequestPtr& /*req*/,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    auto resp = HttpResponse::newHttpResponse();
    resp->setStatusCode(k200OK);
    resp->addHeader("Access-Control-Allow-Origin", "*");
    resp->addHeader("Access-Control-Allow-Methods",
                    "GET,POST,PUT,DELETE,OPTIONS");
    resp->addHeader("Access-Control-Allow-Headers",
                    "Origin,Content-Type,Accept,Authorization");
    callback(resp);
}

void ApiController::handleMotorOptions(
    const HttpRequestPtr& /*req*/,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    auto resp = HttpResponse::newHttpResponse();
    resp->setStatusCode(k200OK);
    resp->addHeader("Access-Control-Allow-Origin", "*");
    resp->addHeader("Access-Control-Allow-Methods",
                    "GET,POST,PUT,DELETE,OPTIONS");
    resp->addHeader("Access-Control-Allow-Headers",
                    "Origin,Content-Type,Accept,Authorization");
    callback(resp);
}

// ---------------- 导航占位接口 ----------------

void ApiController::handleNavOptions(
    const HttpRequestPtr& /*req*/,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    auto resp = HttpResponse::newHttpResponse();
    resp->setStatusCode(k200OK);
    resp->addHeader("Access-Control-Allow-Origin", "*");
    resp->addHeader("Access-Control-Allow-Methods",
                    "GET,POST,PUT,DELETE,OPTIONS");
    resp->addHeader("Access-Control-Allow-Headers",
                    "Origin,Content-Type,Accept,Authorization");
    callback(resp);
}

void ApiController::navListMaps(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    try {
        AuthClaims claims;
        if (!requireAuth(req, callback, claims)) return;

        const auto maps = NavManager::getInstance().listMaps();
        Json::Value json;
        json["success"] = true;
        json["loaded_map_id"] = NavManager::getInstance().getLoadedMapId();
        Json::Value maps_json(Json::arrayValue);
        for (const auto& map_info : maps) {
            maps_json.append(mapToJson(map_info));
        }
        json["maps"] = maps_json;

        callback(HttpResponse::newHttpJsonResponse(json));
    } catch (const std::exception& e) {
        callback(createErrorResponse(
            "Failed to list maps: " + std::string(e.what()), 500));
    }
}

void ApiController::navLoadMap(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    try {
        AuthClaims claims;
        if (!requireAuth(req, callback, claims)) return;

        Json::Value body_json;
        Json::CharReaderBuilder reader_builder;
        std::string errors;
        std::unique_ptr<Json::CharReader> reader(
            reader_builder.newCharReader());
        const std::string body = std::string(req->getBody());
        if (!reader->parse(body.c_str(), body.c_str() + body.length(),
                           &body_json, &errors)) {
            callback(createErrorResponse("Invalid JSON: " + errors));
            return;
        }
        if (!body_json.isMember("map_id")) {
            callback(createErrorResponse("Missing required field: map_id"));
            return;
        }

        const std::string map_id = body_json["map_id"].asString();
        auto& nav = NavManager::getInstance();
        // 建图中禁止切图，避免多端指令与 SLAM 冲突
        if (nav.isMappingActive() ||
            RobotStateManager::getInstance().getState().action == "MAP_BUILD") {
            callback(createErrorResponse(
                "Mapping in progress, cannot load map", 409));
            return;
        }
        if (!nav.loadMap(map_id)) {
            callback(createErrorResponse("Map not found: " + map_id, 404));
            return;
        }

        // 下发 MAP/LOAD；UI 仍显示当前图，待 Lyos current_map 变化后再对齐
        std::string pub_err;
        if (!publishMapIotCmd("LOAD", map_id, pub_err)) {
            callback(createErrorResponse(pub_err, 500));
            return;
        }

        Json::Value json;
        json["success"] = true;
        json["message"] = "MAP LOAD sent; waiting for state machine current_map";
        json["requested_map_id"] = map_id;
        json["loaded_map_id"] = nav.getLoadedMapId();
        callback(HttpResponse::newHttpJsonResponse(json));
    } catch (const std::exception& e) {
        callback(createErrorResponse(
            "Failed to load map: " + std::string(e.what()), 500));
    }
}

void ApiController::navDeleteMap(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback,
    const std::string& map_id) {
    try {
        AuthClaims claims;
        if (!requireAuth(req, callback, claims)) return;

        // 不允许删除当前已加载地图，避免导航态悬空
        if (NavManager::getInstance().getLoadedMapId() == map_id) {
            callback(createErrorResponse(
                "Cannot delete the currently loaded map", 409));
            return;
        }

        if (!NavManager::getInstance().deleteMap(map_id)) {
            callback(createErrorResponse("Map not found: " + map_id, 404));
            return;
        }
        callback(createSuccessResponse("Map deleted"));
    } catch (const std::exception& e) {
        callback(createErrorResponse(
            "Failed to delete map: " + std::string(e.what()), 500));
    }
}

void ApiController::navGetCurrentResources(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    try {
        AuthClaims claims;
        if (!requireAuth(req, callback, claims)) return;

        const std::string loaded_map_id = NavManager::getInstance().getLoadedMapId();
        Json::Value json;
        json["success"] = true;
        json["loaded_map_id"] = loaded_map_id;

        const auto map_info = NavManager::getInstance().getLoadedMap();
        if (map_info.has_value()) {
            json["map"] = mapToJson(map_info.value());

            Json::Value waypoints(Json::arrayValue);
            for (const auto& waypoint :
                 NavManager::getInstance().listWaypoints(loaded_map_id)) {
                waypoints.append(waypointToJson(waypoint));
            }
            json["waypoints"] = waypoints;

            Json::Value routes(Json::arrayValue);
            for (const auto& route :
                 NavManager::getInstance().listRoutes(loaded_map_id)) {
                routes.append(routeToJson(route));
            }
            json["routes"] = routes;
        } else {
            json["map"] = Json::nullValue;
            json["waypoints"] = Json::Value(Json::arrayValue);
            json["routes"] = Json::Value(Json::arrayValue);
        }

        callback(HttpResponse::newHttpJsonResponse(json));
    } catch (const std::exception& e) {
        callback(createErrorResponse(
            "Failed to get current map resources: " + std::string(e.what()),
            500));
    }
}

void ApiController::navGetMapImage(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback,
    const std::string& map_id) {
    try {
        AuthClaims claims;
        if (!requireAuth(req, callback, claims)) return;

        // 建图会话内存图（不进列表）
        if (map_id == "mapping") {
            std::vector<uint8_t> bmp;
            uint64_t revision = 0;
            if (!NavManager::getInstance().getMappingBmp(bmp, revision)) {
                callback(createErrorResponse("Mapping image not ready", 404));
                return;
            }
            auto resp = HttpResponse::newHttpResponse();
            resp->setStatusCode(k200OK);
            resp->setContentTypeString("image/bmp");
            resp->setBody(std::string(reinterpret_cast<const char*>(bmp.data()),
                                      bmp.size()));
            resp->addHeader("Cache-Control", "no-cache");
            resp->addHeader("X-Map-Revision", std::to_string(revision));
            callback(resp);
            return;
        }

        const auto map_info = NavManager::getInstance().getMap(map_id);
        if (!map_info.has_value() || map_info->image_path.empty()) {
            callback(createErrorResponse("Map image not found", 404));
            return;
        }

        GrayImage img;
        std::string err;
        if (!loadPgmFile(map_info->image_path, img, err)) {
            callback(createErrorResponse(err, 500));
            return;
        }
        std::vector<uint8_t> bmp;
        if (!encodeGrayBmp(img, bmp, err)) {
            callback(createErrorResponse(err, 500));
            return;
        }

        auto resp = HttpResponse::newHttpResponse();
        resp->setStatusCode(k200OK);
        resp->setContentTypeString("image/bmp");
        resp->setBody(
            std::string(reinterpret_cast<const char*>(bmp.data()), bmp.size()));
        resp->addHeader("Cache-Control", "no-cache");
        callback(resp);
    } catch (const std::exception& e) {
        callback(createErrorResponse(
            "Failed to get map image: " + std::string(e.what()), 500));
    }
}

void ApiController::navGetMapInfo(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback,
    const std::string& map_id) {
    try {
        AuthClaims claims;
        if (!requireAuth(req, callback, claims)) return;

        // 确认地图在库中，并定位离线目录
        NavManager::getInstance().listMaps();
        const auto map_info = NavManager::getInstance().getMap(map_id);
        if (!map_info.has_value()) {
            callback(createErrorResponse("Map not found", 404));
            return;
        }

        const std::string maps_root = ViewConfigManager::getInstance()
                                          .getConfig()
                                          .localMapsPathOrDefault();
        const std::string map_dir =
            (std::filesystem::path(maps_root) / map_id).string();

        std::string pgm_path;
        std::string yaml_path;
        std::string err;
        if (!resolveMap2dPaths(map_dir, pgm_path, yaml_path, err)) {
            callback(createErrorResponse(err, 404));
            return;
        }

        std::vector<uint8_t> pgm_bytes;
        std::vector<uint8_t> yaml_bytes;
        if (!readFileBytes(pgm_path, pgm_bytes, err) ||
            !readFileBytes(yaml_path, yaml_bytes, err)) {
            callback(createErrorResponse(err, 500));
            return;
        }

        Json::Value json;
        json["success"] = true;
        json["map_id"] = map_id;
        json["pgm_name"] =
            std::filesystem::path(pgm_path).filename().string();
        json["yaml_name"] =
            std::filesystem::path(yaml_path).filename().string();
        json["pgm_base64"] = drogon::utils::base64Encode(
            pgm_bytes.data(), pgm_bytes.size());
        json["yaml"] = std::string(
            reinterpret_cast<const char*>(yaml_bytes.data()), yaml_bytes.size());
        auto resp = HttpResponse::newHttpJsonResponse(json);
        resp->addHeader("Cache-Control", "no-cache");
        callback(resp);
    } catch (const std::exception& e) {
        callback(createErrorResponse(
            "Failed to get map info: " + std::string(e.what()), 500));
    }
}

void ApiController::navPutMapPgm(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback,
    const std::string& map_id) {
    try {
        AuthClaims claims;
        if (!requireAuth(req, callback, claims)) return;

        NavManager::getInstance().listMaps();
        if (!NavManager::getInstance().getMap(map_id).has_value()) {
            callback(createErrorResponse("Map not found", 404));
            return;
        }

        const std::string maps_root = ViewConfigManager::getInstance()
                                          .getConfig()
                                          .localMapsPathOrDefault();
        const std::string map_dir =
            (std::filesystem::path(maps_root) / map_id).string();

        std::string pgm_path;
        std::string yaml_path;
        std::string err;
        // 覆盖目标固定为 map_2d.pgm（yaml 仅用于存在性校验）
        if (!resolveMap2dPaths(map_dir, pgm_path, yaml_path, err)) {
            callback(createErrorResponse(err, 404));
            return;
        }

        const std::string body = std::string(req->getBody());
        std::vector<uint8_t> data(body.begin(), body.end());
        if (!looksLikePgm(data)) {
            callback(createErrorResponse(
                "Invalid PGM body (expect P2/P5 magic)", 400));
            return;
        }

        if (!writeFileAtomic(pgm_path, data, err)) {
            callback(createErrorResponse(err, 500));
            return;
        }

        // 刷新内存元数据（宽高随栅格变化）
        NavManager::getInstance().listMaps();

        Json::Value json;
        json["success"] = true;
        json["message"] = "Map pgm saved";
        json["map_id"] = map_id;
        json["pgm_name"] =
            std::filesystem::path(pgm_path).filename().string();
        json["reload_sent"] = false;

        // 编辑的是当前已加载图：落盘成功后再发 MAP/LOAD，由状态机重载
        auto& nav = NavManager::getInstance();
        if (nav.getLoadedMapId() == map_id && !nav.isMappingActive()) {
            std::string pub_err;
            if (publishMapIotCmd("LOAD", map_id, pub_err)) {
                json["reload_sent"] = true;
                json["message"] = "Map pgm saved; MAP LOAD sent";
            } else {
                json["reload_error"] = pub_err;
                json["message"] =
                    "Map pgm saved; MAP LOAD failed: " + pub_err;
            }
        }

        callback(HttpResponse::newHttpJsonResponse(json));
    } catch (const std::exception& e) {
        callback(createErrorResponse(
            "Failed to save map pgm: " + std::string(e.what()), 500));
    }
}

void ApiController::navCreateWaypoint(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    try {
        AuthClaims claims;
        if (!requireAuth(req, callback, claims)) return;

        Json::Value body_json;
        Json::CharReaderBuilder reader_builder;
        std::string errors;
        std::unique_ptr<Json::CharReader> reader(
            reader_builder.newCharReader());
        const std::string body = std::string(req->getBody());
        if (!reader->parse(body.c_str(), body.c_str() + body.length(),
                           &body_json, &errors)) {
            callback(createErrorResponse("Invalid JSON: " + errors));
            return;
        }
        if (!body_json.isMember("map_id") || !body_json.isMember("name")) {
            callback(createErrorResponse(
                "Missing required fields: map_id, name"));
            return;
        }

        const auto waypoint = NavManager::getInstance().addWaypoint(
            body_json["map_id"].asString(), body_json["name"].asString(),
            body_json.get("x", 0).asDouble(),
            body_json.get("y", 0).asDouble(),
            body_json.get("yaw", 0).asDouble(),
            body_json.get("description", "").asString());

        if (!waypoint.has_value()) {
            callback(createErrorResponse(
                "Failed to create waypoint: map not found or invalid data", 400));
            return;
        }

        Json::Value json;
        json["success"] = true;
        json["waypoint"] = waypointToJson(waypoint.value());
        callback(HttpResponse::newHttpJsonResponse(json));
    } catch (const std::exception& e) {
        callback(createErrorResponse(
            "Failed to create waypoint: " + std::string(e.what()), 500));
    }
}

void ApiController::navDeleteWaypoint(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback,
    const std::string& waypoint_id) {
    try {
        AuthClaims claims;
        if (!requireAuth(req, callback, claims)) return;

        if (!NavManager::getInstance().deleteWaypoint(waypoint_id)) {
            callback(createErrorResponse(
                "Waypoint not found: " + waypoint_id, 404));
            return;
        }
        callback(createSuccessResponse("Waypoint deleted"));
    } catch (const std::exception& e) {
        callback(createErrorResponse(
            "Failed to delete waypoint: " + std::string(e.what()), 500));
    }
}

void ApiController::navCreateRoute(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    try {
        AuthClaims claims;
        if (!requireAuth(req, callback, claims)) return;

        Json::Value body_json;
        Json::CharReaderBuilder reader_builder;
        std::string errors;
        std::unique_ptr<Json::CharReader> reader(
            reader_builder.newCharReader());
        const std::string body = std::string(req->getBody());
        if (!reader->parse(body.c_str(), body.c_str() + body.length(),
                           &body_json, &errors)) {
            callback(createErrorResponse("Invalid JSON: " + errors));
            return;
        }
        if (!body_json.isMember("name") || !body_json.isMember("waypoint_ids")) {
            callback(createErrorResponse(
                "Missing required fields: name, waypoint_ids"));
            return;
        }

        std::vector<std::string> waypoint_ids;
        for (const auto& waypoint_id : body_json["waypoint_ids"]) {
            waypoint_ids.push_back(waypoint_id.asString());
        }
        if (waypoint_ids.empty()) {
            callback(createErrorResponse("waypoint_ids cannot be empty"));
            return;
        }

        const auto route = NavManager::getInstance().addRoute(
            body_json["name"].asString(),
            body_json.get("description", "").asString(), waypoint_ids);
        if (!route.has_value()) {
            callback(createErrorResponse(
                "Failed to create route: invalid waypoint_ids", 400));
            return;
        }

        Json::Value json;
        json["success"] = true;
        json["route"] = routeToJson(route.value());
        callback(HttpResponse::newHttpJsonResponse(json));
    } catch (const std::exception& e) {
        callback(createErrorResponse(
            "Failed to create route: " + std::string(e.what()), 500));
    }
}

void ApiController::navDeleteRoute(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback,
    const std::string& route_id) {
    try {
        AuthClaims claims;
        if (!requireAuth(req, callback, claims)) return;

        if (!NavManager::getInstance().deleteRoute(route_id)) {
            callback(createErrorResponse("Route not found: " + route_id, 404));
            return;
        }
        callback(createSuccessResponse("Route deleted"));
    } catch (const std::exception& e) {
        callback(createErrorResponse(
            "Failed to delete route: " + std::string(e.what()), 500));
    }
}

void ApiController::navStartRouteTask(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    try {
        AuthClaims claims;
        if (!requireAuth(req, callback, claims)) return;

        Json::Value body_json;
        Json::CharReaderBuilder reader_builder;
        std::string errors;
        std::unique_ptr<Json::CharReader> reader(
            reader_builder.newCharReader());
        const std::string body = std::string(req->getBody());
        if (!reader->parse(body.c_str(), body.c_str() + body.length(),
                           &body_json, &errors)) {
            callback(createErrorResponse("Invalid JSON: " + errors));
            return;
        }
        const std::string route_id = body_json.get("route_id", "").asString();
        if (route_id.empty()) {
            callback(createErrorResponse("Missing required field: route_id"));
            return;
        }

        auto& nav = NavManager::getInstance();
        // 硬门禁：publish START 前统一校验（建图/定位/地图）
        std::string gate_reason;
        if (!nav.canStartNavigation(gate_reason)) {
            callback(createErrorResponse(gate_reason, 409));
            return;
        }

        const auto param_opt = nav.buildRouteNavParam(route_id);
        if (!param_opt.has_value()) {
            callback(createErrorResponse(
                "Failed to build NAV param: route or waypoints missing", 400));
            return;
        }

        std::string pub_err;
        if (!publishNavIotCmd("START", param_opt.value(), pub_err)) {
            callback(createErrorResponse(pub_err, 500));
            return;
        }

        if (!nav.startRouteTask(route_id)) {
            callback(createErrorResponse(
                "Failed to start route task: route not found or map mismatch",
                400));
            return;
        }

        Json::Value json;
        json["success"] = true;
        json["message"] = "NAV START command sent";
        json["route_id"] = route_id;
        json["param"] = param_opt.value();
        json["active_task_kind"] = "route";
        callback(HttpResponse::newHttpJsonResponse(json));
    } catch (const std::exception& e) {
        callback(createErrorResponse(
            "Failed to start route task: " + std::string(e.what()), 500));
    }
}

void ApiController::navPauseRouteTask(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    try {
        AuthClaims claims;
        if (!requireAuth(req, callback, claims)) return;

        auto& nav = NavManager::getInstance();
        std::string pub_err;
        if (!publishNavIotCmd("PAUSE", "", pub_err)) {
            callback(createErrorResponse(pub_err, 500));
            return;
        }
        if (!nav.pauseRouteTask()) {
            callback(createErrorResponse("No active route task to pause", 400));
            return;
        }
        callback(createSuccessResponse("NAV PAUSE sent"));
    } catch (const std::exception& e) {
        callback(createErrorResponse(
            "Failed to pause route task: " + std::string(e.what()), 500));
    }
}

void ApiController::navResumeRouteTask(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    try {
        AuthClaims claims;
        if (!requireAuth(req, callback, claims)) return;

        auto& nav = NavManager::getInstance();
        std::string pub_err;
        if (!publishNavIotCmd("RESUME", "", pub_err)) {
            callback(createErrorResponse(pub_err, 500));
            return;
        }
        if (!nav.resumeRouteTask()) {
            callback(createErrorResponse("No active route task to resume", 400));
            return;
        }
        callback(createSuccessResponse("NAV RESUME sent"));
    } catch (const std::exception& e) {
        callback(createErrorResponse(
            "Failed to resume route task: " + std::string(e.what()), 500));
    }
}

void ApiController::navStopRouteTask(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    try {
        AuthClaims claims;
        if (!requireAuth(req, callback, claims)) return;

        auto& nav = NavManager::getInstance();
        std::string pub_err;
        if (!publishNavIotCmd("STOP", "", pub_err)) {
            callback(createErrorResponse(pub_err, 500));
            return;
        }
        nav.stopRouteTask();
        callback(createSuccessResponse("NAV STOP sent"));
    } catch (const std::exception& e) {
        callback(createErrorResponse(
            "Failed to stop route task: " + std::string(e.what()), 500));
    }
}

void ApiController::navStartPointTask(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    try {
        AuthClaims claims;
        if (!requireAuth(req, callback, claims)) return;

        Json::Value body_json;
        Json::CharReaderBuilder reader_builder;
        std::string errors;
        std::unique_ptr<Json::CharReader> reader(
            reader_builder.newCharReader());
        const std::string body = std::string(req->getBody());
        if (!reader->parse(body.c_str(), body.c_str() + body.length(),
                           &body_json, &errors)) {
            callback(createErrorResponse("Invalid JSON: " + errors));
            return;
        }
        if (!body_json.isMember("x") || !body_json.isMember("y")) {
            callback(createErrorResponse("Missing required fields: x, y"));
            return;
        }

        const double x = body_json["x"].asDouble();
        const double y = body_json["y"].asDouble();
        const double yaw = body_json.get("yaw", 0).asDouble();

        auto& nav = NavManager::getInstance();
        // 硬门禁：与线路启动同一套（建图/定位/地图），避免 API 层各自判断
        std::string gate_reason;
        if (!nav.canStartNavigation(gate_reason)) {
            callback(createErrorResponse(gate_reason, 409));
            return;
        }

        const std::string param = NavManager::formatPointNavParam(x, y, yaw);
        std::string pub_err;
        if (!publishNavIotCmd("START", param, pub_err)) {
            callback(createErrorResponse(pub_err, 500));
            return;
        }

        if (!nav.startPointTask(x, y, yaw)) {
            callback(createErrorResponse(
                "Failed to start point task: gate rejected", 409));
            return;
        }

        Json::Value json;
        json["success"] = true;
        json["message"] = "NAV START (quick nav) command sent";
        json["param"] = param;
        json["active_task_kind"] = "point";
        json["x"] = x;
        json["y"] = y;
        json["yaw"] = yaw;
        callback(HttpResponse::newHttpJsonResponse(json));
    } catch (const std::exception& e) {
        callback(createErrorResponse(
            "Failed to start point task: " + std::string(e.what()), 500));
    }
}

void ApiController::navStartMapping(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    try {
        AuthClaims claims;
        if (!requireAuth(req, callback, claims)) return;

        // 开始建图必须带地图名称，作为 MAP/START 的 param（供 SLAM 落盘与实时图 ID）
        Json::Value body_json;
        Json::CharReaderBuilder reader_builder;
        std::string errors;
        std::unique_ptr<Json::CharReader> reader(
            reader_builder.newCharReader());
        const std::string body = std::string(req->getBody());
        if (body.empty() ||
            !reader->parse(body.c_str(), body.c_str() + body.length(),
                           &body_json, &errors)) {
            callback(createErrorResponse(
                body.empty() ? "Missing JSON body with map_name"
                             : ("Invalid JSON: " + errors)));
            return;
        }
        std::string map_name = body_json.get("map_name", "").asString();
        // 去掉首尾空白
        const auto not_space = [](unsigned char c) { return !std::isspace(c); };
        map_name.erase(map_name.begin(),
                       std::find_if(map_name.begin(), map_name.end(), not_space));
        map_name.erase(
            std::find_if(map_name.rbegin(), map_name.rend(), not_space).base(),
            map_name.end());
        if (map_name.empty()) {
            callback(createErrorResponse("Missing required field: map_name"));
            return;
        }
        if (map_name.find('/') != std::string::npos ||
            map_name.find('\\') != std::string::npos ||
            map_name.find(',') != std::string::npos) {
            callback(createErrorResponse(
                "map_name must not contain path separators or commas"));
            return;
        }

        // 当前仅支持在线建图：MAP/START param 固定为 "online,<map_name>"
        // 与导航启动共用域占用门禁（有导航/建图/定位任务则拒）
        std::string gate_reason;
        if (!NavManager::getInstance().canStartNavDomainTask(gate_reason)) {
            callback(createErrorResponse(gate_reason, 409));
            return;
        }

        const std::string param = "online," + map_name;

        std::string pub_err;
        if (!publishMapIotCmd("START", param, pub_err)) {
            callback(createErrorResponse(pub_err, 500));
            return;
        }
        // 只记名 + 发指令；预览开关跟状态机 MAP_BUILD
        NavManager::getInstance().noteMappingStartName(map_name);

        Json::Value json;
        json["success"] = true;
        json["message"] = "Mapping START command sent";
        json["map_name"] = map_name;
        json["param"] = param;
        callback(HttpResponse::newHttpJsonResponse(json));
    } catch (const std::exception& e) {
        callback(createErrorResponse(
            "Failed to start mapping: " + std::string(e.what()), 500));
    }
}

void ApiController::navStopMapping(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    try {
        AuthClaims claims;
        if (!requireAuth(req, callback, claims)) return;

        std::string pub_err;
        if (!publishMapIotCmd("STOP", "", pub_err)) {
            callback(createErrorResponse(pub_err, 500));
            return;
        }
        // 只发 STOP；离开 MAP_BUILD 后由 NavManager::updateFromLyos 扫盘加载
        Json::Value json;
        json["success"] = true;
        json["message"] = "Mapping STOP command sent";
        callback(HttpResponse::newHttpJsonResponse(json));
    } catch (const std::exception& e) {
        callback(createErrorResponse(
            "Failed to stop mapping: " + std::string(e.what()), 500));
    }
}

void ApiController::navRelocalize(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    try {
        AuthClaims claims;
        if (!requireAuth(req, callback, claims)) return;

        // 自动重定位：有导航域任务时禁止；不检查运控 RUNNING
        std::string gate_reason;
        if (!NavManager::getInstance().canRelocalize(/*manual=*/false,
                                                    gate_reason)) {
            callback(createErrorResponse(gate_reason, 409));
            return;
        }

        std::string pub_err;
        if (!publishLocIotCmd("", pub_err)) {
            callback(createErrorResponse(pub_err, 500));
            return;
        }
        callback(createSuccessResponse("Active LOC START command sent"));
    } catch (const std::exception& e) {
        callback(createErrorResponse(
            "Failed to relocalize: " + std::string(e.what()), 500));
    }
}

void ApiController::navManualRelocalize(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    try {
        AuthClaims claims;
        if (!requireAuth(req, callback, claims)) return;

        Json::Value body_json;
        Json::CharReaderBuilder reader_builder;
        std::string errors;
        std::unique_ptr<Json::CharReader> reader(
            reader_builder.newCharReader());
        const std::string body = std::string(req->getBody());
        if (!reader->parse(body.c_str(), body.c_str() + body.length(),
                           &body_json, &errors)) {
            callback(createErrorResponse("Invalid JSON: " + errors));
            return;
        }
        if (!body_json.isMember("x") || !body_json.isMember("y")) {
            callback(createErrorResponse("Missing required fields: x, y"));
            return;
        }

        const double x = body_json["x"].asDouble();
        const double y = body_json["y"].asDouble();
        const double yaw = body_json.get("yaw", 0).asDouble();

        // 手动重定位：有导航域任务时禁止；不检查运控 RUNNING；需已加载地图
        std::string gate_reason;
        if (!NavManager::getInstance().canRelocalize(/*manual=*/true,
                                                    gate_reason)) {
            callback(createErrorResponse(gate_reason, 409));
            return;
        }

        // param：真实地图坐标 + 朝向 "x,y,yaw"（无 z）
        std::ostringstream param_ss;
        param_ss << std::fixed << std::setprecision(6) << x << "," << y << ","
                 << yaw;
        const std::string param = param_ss.str();

        std::string pub_err;
        if (!publishLocIotCmd(param, pub_err)) {
            callback(createErrorResponse(pub_err, 500));
            return;
        }

        Json::Value json;
        json["success"] = true;
        json["message"] = "Manual LOC START command sent";
        json["x"] = x;
        json["y"] = y;
        json["yaw"] = yaw;
        json["param"] = param;
        json["topic"] = "/iot/command";
        callback(HttpResponse::newHttpJsonResponse(json));
    } catch (const std::exception& e) {
        callback(createErrorResponse(
            "Failed to manual relocalize: " + std::string(e.what()), 500));
    }
}

void ApiController::calibrateMotors(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    try {
        AuthClaims claims;
        if (!requireAuth(req, callback, claims)) return;
        if (!requireAdmin(claims, callback)) return;
        // 发布到 /motor_control/motor_config
        static lyos::Publisher<node_control_msgs::msg::MotorConfig>
            motor_config_publisher("/motor_control/motor_config");
        static bool publisher_advertised = false;

        if (!publisher_advertised) {
            lyos::nh()->advertise(motor_config_publisher, false);
            publisher_advertised = true;
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }

        node_control_msgs::msg::MotorConfig cfg_msg;
        // 对齐你给的命令：motor_id=255（全配），parameter_id=3，value=0.0
        cfg_msg.motor_id() = 255;
        cfg_msg.config().parameter_id() = 3;
        cfg_msg.config().parameter_value() = 0.0f;

        int result = motor_config_publisher.publish(cfg_msg);
        if (result >= 0) {
            std::cout << "[ApiController] Published motor_config calibrate "
                         "(motor_id=255, parameter_id=3)"
                      << std::endl;
            callback(createSuccessResponse("Motor calibration command sent"));
        } else {
            callback(
                createErrorResponse("Failed to publish motor_config", 500));
        }
    } catch (const std::exception& e) {
        std::cerr << "[ApiController] Error in calibrateMotors: " << e.what()
                  << std::endl;
        callback(createErrorResponse(
            "Failed to calibrate motors: " + std::string(e.what()), 500));
    }
}

void ApiController::handleFilesOptions(
    const HttpRequestPtr& /*req*/,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    auto resp = HttpResponse::newHttpResponse();
    resp->setStatusCode(k200OK);
    resp->addHeader("Access-Control-Allow-Origin", "*");
    resp->addHeader("Access-Control-Allow-Methods",
                    "GET,POST,PUT,DELETE,OPTIONS");
    resp->addHeader("Access-Control-Allow-Headers",
                    "Origin,Content-Type,Accept,Authorization");
    callback(resp);
}

// 通过 ProcessControl 重启 diagnostics，使当前 .mcap.active 落盘为 .mcap
void ApiController::rotateBag(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    try {
        AuthClaims claims;
        if (!requireAuth(req, callback, claims)) return;
        if (!requireDeveloper(claims, callback)) return;

        std::string error_msg;
        if (!restartDiagnosticsProcess(error_msg)) {
            callback(createErrorResponse(
                "Failed to restart diagnostics: " + error_msg, 500));
            return;
        }

        // 给 rename 落盘一点时间，便于前端刷新后立刻看到 .mcap
        std::this_thread::sleep_for(std::chrono::milliseconds(800));

        std::cout << "[ApiController] rotateBag: restarted diagnostics by "
                  << claims.username << " (" << claims.role << ")" << std::endl;
        callback(createSuccessResponse(
            "diagnostics restarted; active bag should be sealed"));
    } catch (const std::exception& e) {
        std::cerr << "[ApiController] Error in rotateBag: " << e.what()
                  << std::endl;
        callback(createErrorResponse(
            "Failed to rotate bag: " + std::string(e.what()), 500));
    }
}

void ApiController::listFiles(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    try {
        AuthClaims claims;
        if (!requireAuth(req, callback, claims)) return;
        // 获取查询参数
        std::string type = req->getParameter("type");  // "log" 或 "bag"
        std::string date_start =
            req->getParameter("date_start");                   // "2026-02-10"
        std::string date_end = req->getParameter("date_end");  // "2026-02-11"
        int page = 1;
        int pageSize = 10;  // 每页显示的文件数量，默认值，与前端保持一致

        try {
            std::string page_str = req->getParameter("page");
            if (!page_str.empty()) {
                page = std::stoi(page_str);
            }
            std::string pageSize_str = req->getParameter("pageSize");
            if (!pageSize_str.empty()) {
                pageSize = std::stoi(pageSize_str);
            }
        } catch (...) {
            // 使用默认值
        }

        // 确定目录路径（来自 roboview.yaml）
        const std::string base_dir = recordingBaseDir(type);
        if (base_dir.empty()) {
            callback(createErrorResponse(
                "Invalid type parameter. Use 'log' or 'bag'", 400));
            return;
        }

        // 检查目录是否存在
        if (!std::filesystem::exists(base_dir) ||
            !std::filesystem::is_directory(base_dir)) {
            callback(createErrorResponse(
                "Directory does not exist: " + base_dir, 404));
            return;
        }

        // 读取目录中的白名单文件（含 log/bag 的 .active）
        std::vector<std::pair<std::string, std::filesystem::file_time_type>>
            files;
        for (const auto& entry :
             std::filesystem::directory_iterator(base_dir)) {
            if (!entry.is_regular_file()) continue;
            std::string filename = entry.path().filename().string();
            const bool allowed = isAllowedFile(type, filename);
            if (allowed) {
                files.push_back({filename, entry.last_write_time()});
            }
        }

        // 按日期筛选
        if (!date_start.empty() || !date_end.empty()) {
            files.erase(
                std::remove_if(files.begin(), files.end(),
                               [&date_start, &date_end](const auto& file_pair) {
                                   std::string filename = file_pair.first;
                                   // 提取文件名中的日期部分（格式：2026-02-10-14-06-59.log）
                                   if (filename.size() < 10) return true;
                                   std::string date_str =
                                       filename.substr(0, 10);  // "2026-02-10"

                                   if (!date_start.empty() &&
                                       date_str < date_start)
                                       return true;
                                   if (!date_end.empty() && date_str > date_end)
                                       return true;
                                   return false;
                               }),
                files.end());
        }

        // 按修改时间排序（最新的在前）
        std::sort(files.begin(), files.end(), [](const auto& a, const auto& b) {
            return a.second > b.second;
        });

        // 分页
        int total = files.size();
        int start_idx = (page - 1) * pageSize;
        int end_idx = std::min(start_idx + pageSize, total);

        Json::Value json;
        json["success"] = true;
        json["total"] = total;
        json["page"] = page;
        json["pageSize"] = pageSize;
        json["totalPages"] = (total + pageSize - 1) / pageSize;

        Json::Value files_array(Json::arrayValue);
        for (int i = start_idx; i < end_idx; i++) {
            Json::Value file_info;
            file_info["name"] = files[i].first;

            // 获取文件大小
            std::filesystem::path file_path =
                std::filesystem::path(base_dir) / files[i].first;
            file_info["size"] =
                static_cast<Json::Int64>(std::filesystem::file_size(file_path));

            // 格式化修改时间
            auto file_time = files[i].second;
            auto sctp = std::chrono::time_point_cast<
                std::chrono::system_clock::duration>(
                file_time - std::filesystem::file_time_type::clock::now() +
                std::chrono::system_clock::now());
            std::time_t tt = std::chrono::system_clock::to_time_t(sctp);
            std::stringstream ss;
            ss << std::put_time(std::localtime(&tt), "%Y-%m-%d %H:%M:%S");
            file_info["modified"] = ss.str();
            // 正在录制：*.log.active / *.mcap.active
            file_info["recording"] = endsWith(files[i].first, ".log.active") ||
                                     endsWith(files[i].first, ".mcap.active");

            files_array.append(file_info);
        }
        json["files"] = files_array;

        auto resp = HttpResponse::newHttpJsonResponse(json);
        resp->setStatusCode(k200OK);
        callback(resp);
    } catch (const std::exception& e) {
        std::cerr << "[ApiController] Error listing files: " << e.what()
                  << std::endl;
        callback(createErrorResponse(
            "Failed to list files: " + std::string(e.what()), 500));
    }
}

void ApiController::downloadFile(
    const HttpRequestPtr& req,
    std::function<void(const HttpResponsePtr&)>&& callback) {
    try {
        AuthClaims claims;
        if (!requireAuth(req, callback, claims)) return;
        std::string type = req->getParameter("type");
        std::string filename = req->getParameter("filename");

        if (type.empty() || filename.empty()) {
            callback(createErrorResponse(
                "Missing required parameters: type and filename", 400));
            return;
        }

        // 确定目录路径（来自 roboview.yaml）
        const std::string base_dir = recordingBaseDir(type);
        if (base_dir.empty()) {
            callback(createErrorResponse(
                "Invalid type parameter. Use 'log' or 'bag'", 400));
            return;
        }

        // 构建文件路径
        std::filesystem::path file_path =
            std::filesystem::path(base_dir) / filename;

        // 安全检查：确保文件在指定目录内（防止路径遍历攻击）
        std::filesystem::path canonical_file =
            std::filesystem::canonical(file_path);
        std::filesystem::path canonical_dir =
            std::filesystem::canonical(base_dir);
        if (canonical_file.string().find(canonical_dir.string()) != 0) {
            callback(createErrorResponse("Invalid file path", 403));
            return;
        }

        // 检查文件是否存在
        if (!std::filesystem::exists(file_path) ||
            !std::filesystem::is_regular_file(file_path)) {
            callback(createErrorResponse("File not found: " + filename, 404));
            return;
        }

        if (!isDownloadableFile(type, filename)) {
            callback(createErrorResponse(
                type == "bag" && endsWith(filename, ".mcap.active")
                    ? "Recording bag is not downloadable; refresh to seal it"
                    : "Invalid file type",
                400));
            return;
        }

        // 创建文件响应（流式传输）
        auto resp = HttpResponse::newFileResponse(file_path.string(), filename);
        resp->setStatusCode(k200OK);
        resp->addHeader("Content-Disposition",
                        "attachment; filename=\"" + filename + "\"");
        callback(resp);
    } catch (const std::exception& e) {
        std::cerr << "[ApiController] Error downloading file: " << e.what()
                  << std::endl;
        callback(createErrorResponse(
            "Failed to download file: " + std::string(e.what()), 500));
    }
}
