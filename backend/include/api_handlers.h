/*
 * @Author: ethan.young Ethan.Yang2@lingyiitech.com
 * @Date: 2026-01-23 19:28:56
 * @LastEditors: ethan.young Ethan.Yang2@lingyiitech.com
 * @LastEditTime: 2026-07-30 19:40:28
 * @FilePath: /build_all/src/roboview/backend/include/api_handlers.h
 * @Description: API 处理器头文件
 */

#pragma once

#include <drogon/HttpController.h>
#include <drogon/HttpAppFramework.h>
#include "robot_state.h"
#include <json/json.h>
#include <chrono>
#include "sensor_msgs/msg/Joy.h"
#include "std_msgs/msg/Bool.h"
#include "geometry_msgs/msg/Twist.h"
#include "node_voice_msgs/msg/VoiceTts.h"
#include "lyos/lyos.h"

namespace robot_monitor {

// REST API 控制器
class ApiController : public drogon::HttpController<ApiController> {
 public:
    ApiController();
    ~ApiController();
    METHOD_LIST_BEGIN
    // 认证（登录无需 JWT；OPTIONS 供 CORS 预检）
    ADD_METHOD_TO(ApiController::authLogin, "/api/v1/auth/login", drogon::Post);
    ADD_METHOD_TO(ApiController::authMe, "/api/v1/auth/me", drogon::Get);
    ADD_METHOD_TO(ApiController::handleAuthOptions, "/api/v1/auth/login",
                  drogon::Options);

    // 获取机器人状态
    ADD_METHOD_TO(ApiController::getStatus, "/api/v1/status", drogon::Get);

    // 系统信息接口
    ADD_METHOD_TO(ApiController::getSystemInfo, "/api/v1/system/info",
                  drogon::Get);

    // 传感器控制接口
    ADD_METHOD_TO(ApiController::controlImu, "/api/v1/sensor/imu/{action}",
                  drogon::Post);
    ADD_METHOD_TO(ApiController::handleOptions, "/api/v1/sensor/imu/{action}",
                  drogon::Options);

    // 状态、模式、动作控制接口
    ADD_METHOD_TO(ApiController::setRobotState, "/api/v1/control/state",
                  drogon::Post);
    ADD_METHOD_TO(ApiController::setRobotMode, "/api/v1/control/mode",
                  drogon::Post);
    ADD_METHOD_TO(ApiController::setRobotAction, "/api/v1/control/action",
                  drogon::Post);
    ADD_METHOD_TO(ApiController::setRobotJoy, "/api/v1/control/joy",
                  drogon::Post);
    // 摇杆输入源：读取/切换 iot_joy_switch / web_joy_switch
    ADD_METHOD_TO(ApiController::getInputMode, "/api/v1/control/input_mode",
                  drogon::Get);
    ADD_METHOD_TO(ApiController::setInputMode, "/api/v1/control/input_mode",
                  drogon::Post);
    // 语音 TTS：播放语音
    ADD_METHOD_TO(ApiController::playVoiceTts, "/api/v1/control/voice/tts",
                  drogon::Post);
    ADD_METHOD_TO(ApiController::handleControlOptions, "/api/v1/control/*",
                  drogon::Options);  // 作用？

    // 脚本控制接口：列出可用脚本 & 执行/停止脚本
    ADD_METHOD_TO(ApiController::listMotionScripts, "/api/v1/control/scripts",
                  drogon::Get);
    ADD_METHOD_TO(ApiController::handleControlOptions,
                  "/api/v1/control/scripts", drogon::Options);
    ADD_METHOD_TO(ApiController::executeMotionScript,
                  "/api/v1/control/script_action", drogon::Post);
    ADD_METHOD_TO(ApiController::handleControlOptions,
                  "/api/v1/control/script_action", drogon::Options);

    // 预留控制接口
    ADD_METHOD_TO(ApiController::startRobot, "/api/v1/control/start",
                  drogon::Post);
    ADD_METHOD_TO(ApiController::stopRobot, "/api/v1/control/stop",
                  drogon::Post);
    ADD_METHOD_TO(ApiController::resetRobot, "/api/v1/control/reset",
                  drogon::Post);

    // 文件下载接口
    ADD_METHOD_TO(ApiController::listFiles, "/api/v1/files/list", drogon::Get);
    ADD_METHOD_TO(ApiController::downloadFile, "/api/v1/files/download",
                  drogon::Get);
    // 落盘当前 bag：等效 robot_control restart diagnostics
    ADD_METHOD_TO(ApiController::rotateBag, "/api/v1/files/rotate_bag",
                  drogon::Post);
    ADD_METHOD_TO(ApiController::handleFilesOptions, "/api/v1/files/*",
                  drogon::Options);

    // 电机标定（发布 /motor_control/motor_config 一次）
    ADD_METHOD_TO(ApiController::calibrateMotors, "/api/v1/motor/calibrate",
                  drogon::Post);
    ADD_METHOD_TO(ApiController::handleMotorOptions, "/api/v1/motor/*",
                  drogon::Options);

    // 导航：建图/重定位占位
    ADD_METHOD_TO(ApiController::navListMaps, "/api/v1/nav/maps", drogon::Get);
    ADD_METHOD_TO(ApiController::navLoadMap, "/api/v1/nav/maps/load",
                  drogon::Post);
    ADD_METHOD_TO(ApiController::navDeleteMap, "/api/v1/nav/maps/{1}",
                  drogon::Delete);
    ADD_METHOD_TO(ApiController::navGetCurrentResources,
                  "/api/v1/nav/maps/current/resources", drogon::Get);
    // 离线地图底图（PGM→BMP）
    ADD_METHOD_TO(ApiController::navGetMapImage, "/api/v1/nav/maps/{1}/image",
                  drogon::Get);
    // 地图编辑桥接：一次取回 map_2d.pgm + map_2d.yaml；PUT 覆盖 map_2d.pgm
    ADD_METHOD_TO(ApiController::navGetMapInfo, "/api/v1/nav/maps/{1}/info",
                  drogon::Get);
    ADD_METHOD_TO(ApiController::navPutMapPgm, "/api/v1/nav/maps/{1}/pgm",
                  drogon::Put);
    ADD_METHOD_TO(ApiController::navCreateWaypoint, "/api/v1/nav/waypoints",
                  drogon::Post);
    ADD_METHOD_TO(ApiController::navDeleteWaypoint,
                  "/api/v1/nav/waypoints/{1}", drogon::Delete);
    ADD_METHOD_TO(ApiController::navCreateRoute, "/api/v1/nav/routes",
                  drogon::Post);
    ADD_METHOD_TO(ApiController::navDeleteRoute, "/api/v1/nav/routes/{1}",
                  drogon::Delete);
    ADD_METHOD_TO(ApiController::navStartRouteTask,
                  "/api/v1/nav/tasks/route/start", drogon::Post);
    ADD_METHOD_TO(ApiController::navPauseRouteTask,
                  "/api/v1/nav/tasks/route/pause", drogon::Post);
    ADD_METHOD_TO(ApiController::navResumeRouteTask,
                  "/api/v1/nav/tasks/route/resume", drogon::Post);
    ADD_METHOD_TO(ApiController::navStopRouteTask,
                  "/api/v1/nav/tasks/route/stop", drogon::Post);
    ADD_METHOD_TO(ApiController::navStartPointTask,
                  "/api/v1/nav/tasks/point/start", drogon::Post);
    ADD_METHOD_TO(ApiController::navStartMapping, "/api/v1/nav/mapping/start",
                  drogon::Post);
    ADD_METHOD_TO(ApiController::navStopMapping, "/api/v1/nav/mapping/stop",
                  drogon::Post);
    // 主动重定位（SLAM 自行尝试）
    ADD_METHOD_TO(ApiController::navRelocalize, "/api/v1/nav/relocalize",
                  drogon::Post);
    // 手动重定位（地图选点 + 方向下发）
    ADD_METHOD_TO(ApiController::navManualRelocalize,
                  "/api/v1/nav/relocalize/manual", drogon::Post);
    ADD_METHOD_TO(ApiController::handleNavOptions, "/api/v1/nav/*",
                  drogon::Options);
    METHOD_LIST_END

    void loadConfig();
    void setIotMode(bool iot_joy_switch, bool web_joy_switch);
    void publishIotJoySwitch(bool iot_joy_switch);

    // 登录：返回 JWT
    void authLogin(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);

    // 当前用户信息（需 Bearer JWT）
    void authMe(const drogon::HttpRequestPtr& req,
                std::function<void(const drogon::HttpResponsePtr&)>&& callback);

    void handleAuthOptions(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);

    // 获取状态
    void getStatus(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);

    // 启动机器人
    void startRobot(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);

    // 停止机器人
    void stopRobot(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);

    // 重置机器人
    void resetRobot(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);

    // 获取系统信息
    void getSystemInfo(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);

    // 控制 IMU（启动/停止）
    void controlImu(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback,
        const std::string& action);

    // 处理 OPTIONS 预检请求
    void handleOptions(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback,
        const std::string& action);

    // 设置机器人状态
    void setRobotState(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);
    // 设置机器人模式
    void setRobotMode(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);
    // 设置机器人动作
    void setRobotAction(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);
    // 原子更新完整网页摇杆状态（move + turn + session_id + seq）
    void setRobotJoy(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);

    // 读取当前摇杆输入源配置
    void getInputMode(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);

    // 切换摇杆输入源：iot_joy_switch / web_joy_switch
    void setInputMode(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);

    // 发布语音 TTS（/voice/tts）
    void playVoiceTts(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);

    // 列出可用运动脚本（TF 树电机控制脚本）
    void listMotionScripts(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);

    // 执行动作脚本：action_name + flag(1=开始,0=停止)
    void executeMotionScript(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);
    // 处理 OPTIONS 预检请求
    void handleControlOptions(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);

    // 文件列表接口
    void listFiles(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);

    // 文件下载接口
    void downloadFile(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);

    // 重启 diagnostics 以落盘当前 .mcap.active（developer 及以上）
    void rotateBag(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);

    // 处理 OPTIONS 预检请求（files 类接口）
    void handleFilesOptions(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);

    // 电机标定：发布 motor_config（motor_id=255，全配）
    void calibrateMotors(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);

    // 处理 OPTIONS 预检请求（motor 类接口）
    void handleMotorOptions(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);
        
    // 导航：地图管理
    void navListMaps(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);
    void navLoadMap(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);
    void navDeleteMap(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback,
        const std::string& map_id);
    void navGetCurrentResources(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);
    void navGetMapImage(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback,
        const std::string& map_id);
    // 地图编辑：一次返回 map_2d.pgm(base64) + map_2d.yaml 文本
    void navGetMapInfo(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback,
        const std::string& map_id);
    // 覆盖落盘 map_2d.pgm
    void navPutMapPgm(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback,
        const std::string& map_id);
    void navCreateWaypoint(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);
    void navDeleteWaypoint(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback,
        const std::string& waypoint_id);
    void navCreateRoute(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);
    void navDeleteRoute(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback,
        const std::string& route_id);
    void navStartRouteTask(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);
    void navPauseRouteTask(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);
    void navResumeRouteTask(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);
    void navStopRouteTask(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);
    void navStartPointTask(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);

    // 导航：建图（发布 IotCmdMsg category=MAP）
    void navStartMapping(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);
    void navStopMapping(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);
    void navRelocalize(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);
    void navManualRelocalize(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);
    // 处理 OPTIONS 预检请求（导航类接口）
    void handleNavOptions(
        const drogon::HttpRequestPtr& req,
        std::function<void(const drogon::HttpResponsePtr&)>&& callback);

    // 网页摇杆控制发布线程（LRS-X 发 /joy，LRD-W 转 cmd_vel）
    void joyThread();

 private:
    // 将 RobotState 转换为 JSON
    Json::Value stateToJson(const RobotState& state);

    // 网页摇杆轴值缓存（HTTP 写入，发布线程读取）
    sensor_msgs::msg::Joy joy_msg_;
    std::thread joy_thread_;
    std::mutex joy_mutex_;
    std::atomic<bool> joy_running_;
    // 有效控制包的租约；超过超时时间即强制清零，防止断网后复读旧指令
    std::chrono::steady_clock::time_point joy_last_command_time_;
    std::string joy_session_id_;
    Json::UInt64 joy_last_sequence_{0};
    bool joy_command_active_{false};
#ifdef PRODUCT_LRD_W
    // LRD-W：Joy 轴值换算为 Twist 后发布 /cmd_vel
    std::shared_ptr<lyos::Publisher<geometry_msgs::msg::Twist>>
        cmd_vel_publisher_;
#else
    // LRS-X 等：直接发布 /joy
    std::shared_ptr<lyos::Publisher<sensor_msgs::msg::Joy>> joy_publisher_;
#endif
    std::shared_ptr<lyos::Publisher<std_msgs::msg::Bool>> iot_joy_publisher_;

    // 创建成功响应
    drogon::HttpResponsePtr createSuccessResponse(const std::string& message);

    // 创建错误响应
    drogon::HttpResponsePtr createErrorResponse(const std::string& error,
                                                int status_code = 400);
};

}  // namespace robot_monitor
