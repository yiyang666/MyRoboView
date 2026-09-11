/**
 * @Author: ethan.young Ethan.Yang2@lingyiitech.com
 * @Date: 2026-01-27 15:28:56
 * @LastEditors: ethan.young Ethan.Yang2@lingyiitech.com
 * @LastEditTime: 2026-03-10 15:41:01
 * @FilePath: /roboview/backend/src/lyos_subscriber.cpp
 * @Description: Lyos 话题订阅器实现（简化版，统一 JSON 格式）
 */

#include "lyos_subscriber.h"
#include "websocket_handler.h"
#include "robot_state.h"
#include "nav_manager.h"
#include "view_config.h"
#include <lyos/lyos.h>
#include <node_app_msgs/msg/LrsState.h>
#include <node_control_msgs/msg/MotorCommandFeedback.h>
#include <node_control_msgs/msg/MotorHealth.h>
#include <nav_msgs/msg/OccupancyGrid.h>
#include <nav_msgs/msg/Path.h>
#include <sensor_msgs/msg/Imu.h>
#include <sensor_msgs/msg/LaserScan.h>
#include <node_driver_msgs/msg/SensorMsgState.h>
#include <node_system_manager/msg/ResourceMonitor.h>
#include <std_msgs/msg/Bool.h>
#include <json/json.h>
#include <algorithm>
#include <iostream>
#include <array>
#include <cstdint>
#include <cmath>
#include <memory>
#include <map>
#include <mutex>
#include <atomic>
#include <chrono>
#include <sstream>
#include <iomanip>
#include <random>
#include <thread>

#define IMU_WINDOW_SIZE 500

namespace robot_monitor {

static std::string formatJointVersion(const std::array<uint8_t, 4>& v) {
    std::ostringstream oss;
    oss << static_cast<int>(v[0]) << "." << static_cast<int>(v[1]) << "."
        << static_cast<int>(v[2]) << "." << static_cast<int>(v[3]);
    return oss.str();
}

// 方案B：后端统一计算单个关节的显示状态，前端只做颜色映射，不再重复业务规则。
// 返回 "ok" | "warning" | "offline"，与前端 3D 着色的三种视觉状态一一对应：
//   - offline：电机离线或状态未知（灰）
//   - ok：健康值为 0（绿）
//   - warning：错误码区间 [0x1000, 0x1FFF]（黄），低 12 位为具体错误码
// warning 时通过 error_code_hex 输出形如 "0x0040" 的错误码，正常/离线时为空串。
static std::string computeJointStatus(const Joint& joint,
                                      std::string& error_code_hex) {
    error_code_hex = "";

    // 电机不在线：置灰
    if (joint.u1_online != 1) {
        return "offline";
    }
    // 健康值为 0：正常
    if (joint.health == 0) {
        return "ok";
    }
    // 错误码区间：异常，取低 12 位作为具体错误码
    if (joint.health >= 0x1000 && joint.health <= 0x1fff) {
        const uint16_t code = joint.health & 0x0fff;
        std::ostringstream oss;
        oss << "0x" << std::uppercase << std::setfill('0') << std::setw(4)
            << std::hex << code;
        error_code_hex = oss.str();
        return "warning";
    }
    // 其他值：状态未知，同样置灰
    return "offline";
}

// 简化的订阅器包装（统一处理，直接转换为 JSON）
class SubscriberWrapper {
 private:
    int motor_count = 0;

    // 广播频率控制时钟
    // std::chrono::steady_clock::time_point motor_health_last_report_time_;
    std::chrono::steady_clock::time_point
        motor_action_feedback_last_report_time_;
    std::chrono::steady_clock::time_point imu_last_report_time_;
    std::chrono::steady_clock::time_point laserscan_last_push_;
    std::chrono::steady_clock::time_point global_path_last_push_;
    std::chrono::steady_clock::time_point local_path_last_push_;
    // std::chrono::steady_clock::time_point monitor_last_report_time_;

    // IMU 频率计算相关
    std::vector<double> imu_timestamps_;  // 时间戳队列（滑动窗口）
    std::mutex imu_freq_mutex_;           // 保护时间戳队列

    // 计算 IMU 频率
    double calculateIMUFrequency() {
        std::lock_guard<std::mutex> lock(imu_freq_mutex_);
        if (imu_timestamps_.size() < 2) {
            return 0.0;
        }

        double t0 = imu_timestamps_[0];
        double t_last = imu_timestamps_.back();
        double time_span = t_last - t0;

        if (time_span <= 0) {
            return 0.0;
        }

        // 频率 = 消息数 / 时间差（秒）
        double frequency = (imu_timestamps_.size() - 1) / time_span;
        return frequency;
    }

    // 清空 IMU 时间戳队列（当没有订阅者时调用）
    void clearIMUTimestamps() {
        std::lock_guard<std::mutex> lock(imu_freq_mutex_);
        imu_timestamps_.clear();
    }

 public:
    SubscriberWrapper()
        : motor_count(ViewConfigManager::getInstance().getConfig().motor_count),
          // motor_health_last_report_time_(std::chrono::steady_clock::now()),
          motor_action_feedback_last_report_time_(
              std::chrono::steady_clock::now()),
          imu_last_report_time_(std::chrono::steady_clock::now()),
          laserscan_last_push_(),
          global_path_last_push_(),
          local_path_last_push_() {}
    // monitor_last_report_time_(std::chrono::steady_clock::now()),{}

    void onStateMessage(const node_app_msgs::msg::LrsState& msg) {
        auto& stateManager = RobotStateManager::getInstance();
        // 系统态始终更新；建图收尾不依赖 WS 是否有客户端
        stateManager.updateFromLyosState(
            msg.current_state(), msg.current_mode(), msg.current_action(),
            msg.running_status(), msg.motor_health(), 48.0, 100, 0);
        RobotState state = stateManager.getState();
        // 导航域一次收敛：task/action + NaviStatus + 位姿 + 建图边沿 + 离导航清路径
        {
            const auto& pose = msg.current_pose();
            const auto& speed = msg.current_speed();
            // pose Vector3：x/y 位置，z = yaw；speed Vector3：x/y 线速度，z 角速度
            NavManager::getInstance().updateFromLyos(
                msg.current_action(), msg.navigation_status(), pose.x(),
                pose.y(), pose.z(), msg.localized(), msg.loc_fitness(),
                speed.x(), speed.y(), speed.z(), msg.distance_to_goal(),
                msg.current_map(), msg.map_loaded());
        }

        if (!WebSocketHandler::hasConnections()) {
            return;
        }

        // 状态数据解析，转换为JSON格式
        Json::Value json_state;
        // 确保包含 connected 字段，这是连接状态的关键
        json_state["connected"] = state.connected;
        json_state["status"] = state.status;
        json_state["mode"] = state.mode;
        json_state["action"] = state.action;
        json_state["running_status"] = state.running_status;
        json_state["motor_health"] = state.motor_health;  // 电机健康状态

        json_state["battery_voltage"] = state.battery_voltage;  // 电压
        json_state["remaining_power"] = state.remaining_power;  // 剩余电量
        json_state["current_temp"] = state.current_temp;        // 电池温度

        // :详细电池状态信息
        json_state["battery_current"] = msg.battery_current();  // 电流
        json_state["startup_cnt"] = msg.startup_cnt();          // 充放电时长
        json_state["battery_state"] = msg.battery_state();      // 电池状态
        json_state["battery_errcode"] = msg.battery_errcode();  // 错误码

        // 广播给所有客户端（broadcastMessage 会处理连接清理）
        // 机器人基础状态主页面需一直订阅
        WebSocketHandler::broadcastMessage("robot_state", json_state);

        // 导航页状态栏的任务/过程态来自本话题：有导航订阅者时同步推送 nav_state
        if (WebSocketHandler::hasPageSubscribers("navigation")) {
            WebSocketHandler::broadcastMessage(
                "nav_state", NavManager::getInstance().toJson(), "navigation");
        }

        // Json::Value position;
        // position["x"] = state.position.x;
        // position["y"] = state.position.y;
        // position["theta"] = state.position.theta;
        // json_state["position"] = position;
    }

    // 电机健康状态消息回调：从 /motor_control/motor_health 获取明细与总体状态
    void onMotorHealthMessage(const node_control_msgs::msg::MotorHealth& msg) {
        // 无客户端连接，不处理数据
        if (!WebSocketHandler::hasConnections()) {
            return;
        }

        // 检查是否需要发送数据（间隔由配置文件控制）
        // TODO: 电机健康状态发送频率为 1HZ,与默认广播频率相同,不做广播频率限制

        auto& stateManager = RobotStateManager::getInstance();
        stateManager.updateMotorHealth(msg.state());
        // stateManager.updateMotorHealthSummary(msg.motor_health());

        RobotState state = stateManager.getState();

        // 统一构建电机状态 JSON（含后端计算的 status / error_code），
        // 一次广播给所有连接：主页 3D 圆环与电机详情页共用同一份数据。
        // 名称由前端 URDF_CONFIG 按 id 映射；此处只下发 id + 健康字段。
        Json::Value motors_data(Json::arrayValue);
        const size_t n = std::min(state.joints.size(),
                                  static_cast<size_t>(std::max(motor_count, 0)));
        for (size_t i = 0; i < n; ++i) {
            const auto& joint = state.joints[i];
            std::string error_code;
            const std::string status = computeJointStatus(joint, error_code);

            Json::Value motor;
            motor["id"] = joint.id;
            motor["status"] = status;          // "ok" | "warning" | "offline"
            motor["error_code"] = error_code;  // 例如 "0x0040"，正常/离线时为空串
            motor["health"] = joint.health;
            motor["motor_direction"] = joint.motor_direction;
            motor["motor_temperature"] = joint.motor_temperature;
            motor["mos_temperature"] = joint.mos_temperature;
            motor["bus_voltage"] = joint.bus_voltage;
            motor["u1_online"] = joint.u1_online;
            motor["position_zero"] = joint.position_zero;
            motor["joint_version"] = formatJointVersion(joint.joint_version);
            motors_data.append(motor);
        }

        Json::Value json_motor_status;
        json_motor_status["motors"] = motors_data;
        json_motor_status["timestamp"] = static_cast<Json::Int64>(
            std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::system_clock::now().time_since_epoch())
                .count());

        WebSocketHandler::broadcastMessage("motor_status_data",
                                           json_motor_status);
    }

    // 电机动作反馈回调：从 /motor_control/motor_comand_feedback 获取
    // position/omega/torque 等；按 index 映射为关节 id，长度受 motor_count 限制
    void onMotorCommandFeedbackMessage(
        const node_control_msgs::msg::MotorCommandFeedback& msg) {
        if (!WebSocketHandler::hasConnections()) {
            return;
        }
        // 检查是否需要发送数据（间隔由配置文件控制）
        auto now = std::chrono::steady_clock::now();
        auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
                           now - motor_action_feedback_last_report_time_)
                           .count();
        auto motor_action_feedback_interval =
            ViewConfigManager::getInstance()
                .getConfig()
                .motor_action_feedback_interval;
        if (elapsed < motor_action_feedback_interval) {
            return;
        }

        const auto& feedback = msg.feedback();
        if (feedback.empty()) {
            return;
        }

        Json::Value joints(Json::arrayValue);
        const int n =
            std::min<int>(static_cast<int>(feedback.size()), motor_count);
        for (int id = 0; id < n; id++) {
            const auto& fb = feedback[id];

            double pos_rad = static_cast<double>(fb.position());
            const double omega_rad_s = static_cast<double>(fb.omega());
            const int torque_nm = static_cast<int>(fb.torque());

            Json::Value j;
            j["id"] = id;
            j["position_rad"] = pos_rad;
            j["omega_rad_s"] = omega_rad_s;
            j["torque_nm"] = torque_nm;
            joints.append(j);
        }

        Json::Value json_data;
        json_data["seq"] = static_cast<Json::UInt64>(msg.seq());
        // 配置参数: 电机动作反馈间隔时间，前端插值算法需要知道这个间隔时间
        json_data["interval_ms"] = motor_action_feedback_interval;
        json_data["joints"] = joints;
        json_data["timestamp"] = static_cast<Json::Int64>(
            std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::system_clock::now().time_since_epoch())
                .count());

        // joint_state：默认广播给所有连接（3D视图需要持续更新）
        WebSocketHandler::broadcastMessage("joint_state", json_data);
        // 更新广播时间
        motor_action_feedback_last_report_time_ = now;
    }

    // IMU 消息回调，计算频率并发送给订阅了传感器页面的客户端
    void onIMUMessage(const sensor_msgs::msg::Imu& msg) {
        // 检查是否有订阅者（提前返回，避免不必要的处理）
        bool has_subscribers = WebSocketHandler::hasConnections() &&
                               WebSocketHandler::hasPageSubscribers("sensor");

        if (!has_subscribers) {
            // 没有订阅者时，清空时间戳队列以节省内存
            clearIMUTimestamps();
            return;
        }

        // 有订阅者时，记录时间戳用于频率计算
        {
            std::lock_guard<std::mutex> lock(imu_freq_mutex_);
            // 使用 steady_clock 获取高精度时间戳（秒）
            auto now = std::chrono::steady_clock::now();
            auto duration = now.time_since_epoch();
            double current_time =
                std::chrono::duration_cast<std::chrono::milliseconds>(duration)
                    .count() /
                1000.0;

            imu_timestamps_.push_back(current_time);

            // 维护滑动窗口
            if (imu_timestamps_.size() > IMU_WINDOW_SIZE) {
                imu_timestamps_.erase(imu_timestamps_.begin());
            }
        }

        // 检查是否需要发送频率数据（间隔由配置文件控制）
        auto now = std::chrono::steady_clock::now();
        auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
                           now - imu_last_report_time_)
                           .count();
        auto imu_interval =
            ViewConfigManager::getInstance().getConfig().imu_interval;
        if (elapsed < imu_interval) {
            return;
        }

        // 计算频率
        double frequency = calculateIMUFrequency();

        // 发送频率数据（而不是完整 IMU 数据）
        Json::Value json_freq;
        json_freq["frequency"] = frequency;
        json_freq["timestamp"] = static_cast<Json::Int64>(
            std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::system_clock::now().time_since_epoch())
                .count());

        // 发送给订阅了传感器页面的客户端
        WebSocketHandler::broadcastMessage("sensor_imu_frequency", json_freq,
                                           "sensor");
        // 更新广播时间
        imu_last_report_time_ = now;
    }

    // 多种传感器都在这发状态消息（暂时注释掉，等待机器imu模块bug修复后再启用）
    // void onSensorStatusMessage(const node_driver_msgs::msg::SensorMsgState&
    // msg) {
    //     // 收到传感器状态消息，直接转发给前端（不保存状态）
    //     // 无客户端连接，或者没有连接订阅传感器页面，不处理
    //     if (!WebSocketHandler::hasConnections() ||
    //     !WebSocketHandler::hasPageSubscribers("sensor")) {
    //         return;
    //     }
    //
    //     Json::Value json_status;
    //     json_status["sensor_type"] = msg.sensor_type();// 0=imu,
    //     json_status["sensor_state"] = msg.sensor_state();  // 0=停止, 1=运行
    //     json_status["error_message"] = msg.error_message();
    //
    //     // 广播给所有客户端（传感器状态更新）
    //     WebSocketHandler::broadcastMessage("sensor_status", json_status,
    //     "sensor");
    // }

    // 资源监控消息回调：将 Lyos 的 ResourceMonitor 消息转换为 JSON 并广播给前端
    void onMonitorMessage(
        const node_system_manager::msg::ResourceMonitor& msg_array) {
        // 没有前端连接或没有订阅资源监控页面时直接返回
        if (!WebSocketHandler::hasConnections() ||
            !WebSocketHandler::hasPageSubscribers("monitor")) {
            return;
        }

        // 检查是否需要发送数据（间隔由配置文件控制）
        // TODO: 资源监控发送频率较低,不做广播频率限制

        Json::Value processes_array(Json::arrayValue);

        // ResourceMonitor 话题消息是一个数组，长度可能为 0、1 或多个
        // 这里假设 msg_array 中包含一个 processes() 容器，元素的字段定义见
        // 消息定义文件：src/robot_ai_msgs/msg/ResourceMonitor.msg
        for (const auto& p : msg_array.res_infos()) {
            Json::Value process_data;
            process_data["process_name"] = p.process_name();
            process_data["pid"] = p.pid();
            process_data["cpu_usage"] = p.cpu_usage();
            process_data["mem_usage"] =
                static_cast<Json::UInt64>(p.mem_usage());
            process_data["rss_anon"] = static_cast<Json::UInt64>(p.rss_anon());
            process_data["rss_file"] = static_cast<Json::UInt64>(p.rss_file());
            process_data["rss_shmem"] =
                static_cast<Json::UInt64>(p.rss_shmem());
            process_data["fd"] = p.fd();

            processes_array.append(process_data);
        }

        Json::Value json_data;
        json_data["processes"] = processes_array;
        json_data["timestamp"] = static_cast<Json::Int64>(
            std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::system_clock::now().time_since_epoch())
                .count());

        // 发送给订阅了监控页面的客户端
        WebSocketHandler::broadcastMessage("monitor_data", json_data,
                                           "monitor");
    }

    void onJoyEnabledMessage(const std_msgs::msg::Bool& msg) {
        bool iot_joy_switch = false;
        bool web_joy_switch = true;

        RobotStateManager::getInstance().getJoyIotState(iot_joy_switch,
                                                        web_joy_switch);

        if (iot_joy_switch) {
            return;
        }

        RobotStateManager::getInstance().updateJoyIotState(true, false);
        if (!WebSocketHandler::hasConnections() || !msg.data() ||
            !WebSocketHandler::hasPageSubscribers("control")) {
            return;
        }

        Json::Value json_data;
        json_data["iot_joy_switch"] = true;
        json_data["web_joy_switch"] = false;
        WebSocketHandler::broadcastMessage("input_mode", json_data, "control");
    }

    // 建图 OccupancyGrid：仅建图会话中写入内存预览（方案 A，限频）
    void onOccupancyGridMessage(const nav_msgs::msg::OccupancyGrid& msg) {
        if (!NavManager::getInstance().isMappingActive()) {
            return;
        }
        NavManager::getInstance().updateMappingFromOccupancyGrid(msg);
    }

    // 预留：LaserScan 限频广播元信息，地图叠加显示待前端实现
    void onLaserScanMessage(const sensor_msgs::msg::LaserScan& msg) {
        if (!WebSocketHandler::hasPageSubscribers("navigation")) {
            return;
        }
        const auto min_interval = std::chrono::milliseconds(
            ViewConfigManager::getInstance()
                .getConfig()
                .maps_laserscan_broadcast_interval_ms);
        const auto now = std::chrono::steady_clock::now();
        if (laserscan_last_push_ != std::chrono::steady_clock::time_point{} &&
            now - laserscan_last_push_ < min_interval) {
            return;
        }
        laserscan_last_push_ = now;

        Json::Value json_data;
        json_data["frame_id"] = msg.header().frame_id();
        json_data["angle_min"] = msg.angle_min();
        json_data["angle_max"] = msg.angle_max();
        json_data["angle_increment"] = msg.angle_increment();
        json_data["range_min"] = msg.range_min();
        json_data["range_max"] = msg.range_max();
        json_data["ranges_count"] = static_cast<int>(msg.ranges().size());
        WebSocketHandler::broadcastMessage("nav_laserscan", json_data,
                                           "navigation");
    }

    /** 导航 Path：有 navigation 页订阅则限频直推前端（任务期话题才有数据） */
    bool shouldPushNavPath(std::chrono::steady_clock::time_point& last_push) {
        if (!WebSocketHandler::hasPageSubscribers("navigation")) {
            return false;
        }
        const auto min_interval = std::chrono::milliseconds(
            ViewConfigManager::getInstance()
                .getConfig()
                .maps_path_broadcast_interval_ms);
        const auto now = std::chrono::steady_clock::now();
        if (last_push != std::chrono::steady_clock::time_point{} &&
            now - last_push < min_interval) {
            return false;
        }
        last_push = now;
        return true;
    }

    void onGlobalPathMessage(const nav_msgs::msg::Path& msg) {
        if (!shouldPushNavPath(global_path_last_push_)) {
            return;
        }
        WebSocketHandler::broadcastMessage(
            "nav_global_path", NavManager::pathMsgToJson(msg), "navigation");
    }

    void onLocalPathMessage(const nav_msgs::msg::Path& msg) {
        if (!shouldPushNavPath(local_path_last_push_)) {
            return;
        }
        WebSocketHandler::broadcastMessage(
            "nav_local_path", NavManager::pathMsgToJson(msg), "navigation");
    }
};

// 订阅器数据（简化版）
struct SubscribersData {
    std::shared_ptr<SubscriberWrapper> wrapper;  // 包装器实例
    std::shared_ptr<
        lyos::Subscriber<node_app_msgs::msg::LrsState, SubscriberWrapper>>
        state_subscriber;
    std::shared_ptr<lyos::Subscriber<
        node_control_msgs::msg::MotorCommandFeedback, SubscriberWrapper>>
        motor_feedback_subscriber;
    std::shared_ptr<lyos::Subscriber<node_control_msgs::msg::MotorHealth,
                                     SubscriberWrapper>>
        motor_health_subscriber;
    std::shared_ptr<lyos::Subscriber<sensor_msgs::msg::Imu, SubscriberWrapper>>
        imu_subscriber;
    std::shared_ptr<lyos::Subscriber<node_driver_msgs::msg::SensorMsgState,
                                     SubscriberWrapper>>
        sensor_status_subscriber;
    std::shared_ptr<lyos::Subscriber<node_system_manager::msg::ResourceMonitor,
                                     SubscriberWrapper>>
        monitor_subscriber;

    // 接受来自遥控器的消息（遥控器使能）
    std::shared_ptr<lyos::Subscriber<std_msgs::msg::Bool, SubscriberWrapper>>
        joy_enabled_subscriber;

    // 建图 OccupancyGrid（/map）
    std::shared_ptr<
        lyos::Subscriber<nav_msgs::msg::OccupancyGrid, SubscriberWrapper>>
        map_subscriber;

    // 预留：LaserScan（话题与广播帧率见 roboview.yaml）
    std::shared_ptr<
        lyos::Subscriber<sensor_msgs::msg::LaserScan, SubscriberWrapper>>
        laser_scan_subscriber;

    // 导航规划路径（global / ted 局部轨迹）
    std::shared_ptr<
        lyos::Subscriber<nav_msgs::msg::Path, SubscriberWrapper>>
        nav_global_path_subscriber;
    std::shared_ptr<
        lyos::Subscriber<nav_msgs::msg::Path, SubscriberWrapper>>
        nav_local_path_subscriber;

    ~SubscribersData() = default;
};

static std::map<LyosSubscriber*, std::shared_ptr<SubscribersData>>
    subscribers_data_map;
static std::mutex subscribers_data_map_mutex;

static void disableSubscriberData(
    const std::shared_ptr<SubscribersData>& data) {
    if (!data) return;
    if (data->state_subscriber) data->state_subscriber->setEnabled(false);
    if (data->motor_health_subscriber) {
        data->motor_health_subscriber->setEnabled(false);
    }
    if (data->motor_feedback_subscriber) {
        data->motor_feedback_subscriber->setEnabled(false);
    }
    if (data->imu_subscriber) data->imu_subscriber->setEnabled(false);
    if (data->sensor_status_subscriber) {
        data->sensor_status_subscriber->setEnabled(false);
    }
    if (data->monitor_subscriber) data->monitor_subscriber->setEnabled(false);
    if (data->joy_enabled_subscriber) {
        data->joy_enabled_subscriber->setEnabled(false);
    }
    if (data->map_subscriber) data->map_subscriber->setEnabled(false);
    if (data->laser_scan_subscriber) {
        data->laser_scan_subscriber->setEnabled(false);
    }
    if (data->nav_global_path_subscriber) {
        data->nav_global_path_subscriber->setEnabled(false);
    }
    if (data->nav_local_path_subscriber) {
        data->nav_local_path_subscriber->setEnabled(false);
    }
}

LyosSubscriber::LyosSubscriber() : subscribers_data_ptr_(nullptr) {}

LyosSubscriber::~LyosSubscriber() { shutdown(); }

bool LyosSubscriber::init() {
    if (initialized_) {
        std::cerr << "LyosSubscriber already initialized" << std::endl;
        return true;
    }

    try {
        auto data = std::make_shared<SubscribersData>();
        const auto& cfg = ViewConfigManager::getInstance().getConfig();
        const auto& topics = cfg.topics;

        // 创建包装器实例
        data->wrapper = std::make_shared<SubscriberWrapper>();

        // 1. 状态订阅器（系统状态、电池电压和整体电机状态）
        data->state_subscriber = std::make_shared<
            lyos::Subscriber<node_app_msgs::msg::LrsState, SubscriberWrapper>>(
            topics.state, &SubscriberWrapper::onStateMessage,
            data->wrapper.get());
        lyos::nh()->subscribe(*data->state_subscriber);

        // 2. 电机健康订阅器
        data->motor_health_subscriber = std::make_shared<lyos::Subscriber<
            node_control_msgs::msg::MotorHealth, SubscriberWrapper>>(
            topics.motor_health, &SubscriberWrapper::onMotorHealthMessage,
            data->wrapper.get());
        lyos::nh()->subscribe(*data->motor_health_subscriber);

        // 2.1 电机动作反馈订阅器（URDF 实时关节角）
        data->motor_feedback_subscriber = std::make_shared<lyos::Subscriber<
            node_control_msgs::msg::MotorCommandFeedback, SubscriberWrapper>>(
            topics.motor_feedback,
            &SubscriberWrapper::onMotorCommandFeedbackMessage,
            data->wrapper.get());
        lyos::nh()->subscribe(*data->motor_feedback_subscriber);

        // 3. IMU 订阅器
        data->imu_subscriber = std::make_shared<
            lyos::Subscriber<sensor_msgs::msg::Imu, SubscriberWrapper>>(
            topics.imu, &SubscriberWrapper::onIMUMessage,
            data->wrapper.get());
        lyos::nh()->subscribe(*data->imu_subscriber);

        // 3.1 传感器状态（预留：回调未实现，仅配置话题）
        if (!topics.sensor_status.empty()) {
            std::cout << "[LyosSubscriber] topic_sensor_status="
                      << topics.sensor_status
                      << " 已配置但尚未启用订阅（等待回调实现）" << std::endl;
        }

        // 4. 资源监控订阅器
        data->monitor_subscriber = std::make_shared<lyos::Subscriber<
            node_system_manager::msg::ResourceMonitor, SubscriberWrapper>>(
            topics.monitor, &SubscriberWrapper::onMonitorMessage,
            data->wrapper.get());
        lyos::nh()->subscribe(*data->monitor_subscriber);

        // 5. 遥控器使能订阅器
        data->joy_enabled_subscriber = std::make_shared<
            lyos::Subscriber<std_msgs::msg::Bool, SubscriberWrapper>>(
            topics.joy_enabled, &SubscriberWrapper::onJoyEnabledMessage,
            data->wrapper.get());
        lyos::nh()->subscribe(*data->joy_enabled_subscriber, true, true);

        // 6. 建图 OccupancyGrid（仅建图会话中写内存预览）
        data->map_subscriber = std::make_shared<
            lyos::Subscriber<nav_msgs::msg::OccupancyGrid, SubscriberWrapper>>(
            topics.mapping_map, &SubscriberWrapper::onOccupancyGridMessage,
            data->wrapper.get());
        lyos::nh()->subscribe(*data->map_subscriber);

        // 7. LaserScan（限频广播 nav_laserscan 元信息；话题置空则不订阅）
        if (!topics.laserscan.empty()) {
            data->laser_scan_subscriber = std::make_shared<
                lyos::Subscriber<sensor_msgs::msg::LaserScan,
                                 SubscriberWrapper>>(
                topics.laserscan, &SubscriberWrapper::onLaserScanMessage,
                data->wrapper.get());
            lyos::nh()->subscribe(*data->laser_scan_subscriber);
        }

        // 8. 导航规划 Path（话题置空则不订阅）
        // 发布端 /planner_server/plan：RELIABLE + VOLATILE → latch=false, reliable=true
        if (!topics.nav_global_path.empty()) {
            data->nav_global_path_subscriber = std::make_shared<
                lyos::Subscriber<nav_msgs::msg::Path, SubscriberWrapper>>(
                topics.nav_global_path,
                &SubscriberWrapper::onGlobalPathMessage, data->wrapper.get());
            lyos::nh()->subscribe(*data->nav_global_path_subscriber, false,
                                 true, 10);
        }
        // 局部持续发（当前多为单点最近目标）：只要最新，BEST_EFFORT + depth 1
        if (!topics.nav_teb_path.empty()) {
            data->nav_local_path_subscriber = std::make_shared<
                lyos::Subscriber<nav_msgs::msg::Path, SubscriberWrapper>>(
                topics.nav_teb_path, &SubscriberWrapper::onLocalPathMessage,
                data->wrapper.get());
            lyos::nh()->subscribe(*data->nav_local_path_subscriber, false,
                                 false, 1);
        }

        // 保存数据指针
        subscribers_data_ptr_ = data.get();
        {
            std::lock_guard<std::mutex> lock(subscribers_data_map_mutex);
            subscribers_data_map[this] = data;
        }

        // 启动事件循环线程
        running_ = true;
        spin_thread_ = std::thread([this]() { this->spinThread(); });

        initialized_ = true;

        std::cout << "[LyosSubscriber] Initialized successfully:" << std::endl;
        std::cout << "  正在订阅话题：" << topics.state << " (状态)" << std::endl;
        std::cout << "  正在订阅话题：" << topics.motor_health
                  << " (电机健康)" << std::endl;
        std::cout << "  正在订阅话题：" << topics.motor_feedback
                  << " (电机动作反馈)" << std::endl;
        std::cout << "  正在订阅话题：" << topics.imu << " (IMU)" << std::endl;
        std::cout << "  正在订阅话题：" << topics.monitor
                  << " (资源监控)" << std::endl;
        std::cout << "  正在订阅话题：" << topics.joy_enabled
                  << " (遥控器使能)" << std::endl;
        std::cout << "  正在订阅话题：" << topics.mapping_map
                  << " (建图 OccupancyGrid)" << std::endl;
        if (!topics.laserscan.empty()) {
            std::cout << "  正在订阅话题：" << topics.laserscan
                      << " (LaserScan 预留)" << std::endl;
        }
        if (!topics.nav_global_path.empty()) {
            std::cout << "  正在订阅话题：" << topics.nav_global_path
                      << " (导航全局路径)" << std::endl;
        }
        if (!topics.nav_teb_path.empty()) {
            std::cout << "  正在订阅话题：" << topics.nav_teb_path
                      << " (导航 TEB 局部轨迹)" << std::endl;
        }
        return true;
    } catch (const std::exception& e) {
        std::cerr << "Failed to initialize LyosSubscriber: " << e.what()
                  << std::endl;
        return false;
    }
}

void LyosSubscriber::disableSubscriptions() {
    if (!initialized_) return;
    std::lock_guard<std::mutex> lock(subscribers_data_map_mutex);
    auto it = subscribers_data_map.find(this);
    if (it != subscribers_data_map.end()) {
        disableSubscriberData(it->second);
    }
}

void LyosSubscriber::shutdown() {
    if (!initialized_) {
        return;
    }

    running_ = false;

    // 用局部 shared_ptr 延长生命周期；先从 map 摘除，避免重复 disable。
    std::shared_ptr<SubscribersData> keep_alive;
    {
        std::lock_guard<std::mutex> lock(subscribers_data_map_mutex);
        auto it = subscribers_data_map.find(this);
        if (it != subscribers_data_map.end()) {
            keep_alive = it->second;
            subscribers_data_map.erase(it);
        }
    }

    disableSubscriberData(keep_alive);

    // main 中应先 disableSubscriptions + lyos::shutdown()，再调用本函数。
    if (spin_thread_.joinable()) {
        spin_thread_.join();
    }

    // 先析构 lyos::Subscriber，再析构 SubscriberWrapper；中间短暂等待
    // 线程池中可能仍在执行的回调结束，避免 pure virtual / UAF。
    if (keep_alive) {
        keep_alive->state_subscriber.reset();
        keep_alive->motor_health_subscriber.reset();
        keep_alive->motor_feedback_subscriber.reset();
        keep_alive->imu_subscriber.reset();
        keep_alive->sensor_status_subscriber.reset();
        keep_alive->monitor_subscriber.reset();
        keep_alive->joy_enabled_subscriber.reset();
        keep_alive->map_subscriber.reset();
        keep_alive->laser_scan_subscriber.reset();
        keep_alive->nav_global_path_subscriber.reset();
        keep_alive->nav_local_path_subscriber.reset();
        std::this_thread::sleep_for(std::chrono::milliseconds(300));
        keep_alive->wrapper.reset();
    }

    keep_alive.reset();
    subscribers_data_ptr_ = nullptr;
    initialized_ = false;
    std::cout << "[LyosSubscriber] Shutdown complete" << std::endl;
}

void LyosSubscriber::spinThread() {
    std::cout << "[LyosSubscriber] Spin thread started" << std::endl;

    try {
        lyos::spin();
    } catch (const std::exception& e) {
        std::cerr << "[LyosSubscriber] Error in spin thread: " << e.what()
                  << std::endl;
    }

    std::cout << "[LyosSubscriber] Spin thread stopped" << std::endl;
}

}  // namespace robot_monitor
