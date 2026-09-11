/*
 * @Author: ethan.young Ethan.Yang2@lingyiitech.com
 * @Date: 2026-01-23 19:28:56
 * @LastEditors: marty marty.gong@lingyiitech.com
 * @LastEditTime: 2026-07-01 11:49:49
 * @FilePath: /build_all/src/roboview/backend/include/robot_state.h
 * @Description: 机器人状态头文件（状态缓存）
 */

#pragma once

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <mutex>
#include <string>
#include <vector>
#include <node_control_msgs/msg/MotorHealthState.h>

namespace robot_monitor {

// 位置信息
// struct Position {
//     double x = 0.0;
//     double y = 0.0;
//     double theta = 0.0;
// };
// 关节健康状态信息结构体（显示名由前端 URDF_CONFIG 按 id 映射，后端不维护）
struct Joint {
    int id = 0;
    std::string name;               // 留空；前端用产品关节表补显示名
    uint16_t health = 0;            // 四位二进制数错误码
    uint8_t motor_direction = 0;    // 电机方向 1:正转 0:反转
    uint8_t motor_temperature = 0;  // 电机温度
    uint8_t mos_temperature = 0;    // mos温度
    uint8_t bus_voltage = 0;        // 母线电压
    uint8_t u1_online = 0;          // 电机在线状态 1:在线 0:离线
    float position_zero = 0.0;      // 电机位置零点
    std::array<uint8_t, 4> joint_version{
        {0, 0, 0, 0}};  // 关节软件版本 [a,b,c,d]
};

// 机器人状态，没有收到过数据时，状态为Unknown
struct RobotState {
    bool connected = false;  // 是否连接(接收到ros2消息即为连接，默认为fasle)
    std::string status = "Unknown";  // 当前状态：DISABLED, DAMPING, READY,
                                     // RUNNING, TRANSITIONING
    std::string mode = "Unknown";    // 当前模式：DEFAULT, DANCE
    std::string action = "Unknown";  // 当前动作：如 "WAVE", "CLASP" 等
    std::string running_status = "Unknown";  // 运行状态：IDLE, RUNNING
    std::string motor_health = "Unknown";    // 电机健康状态：ERROR,OK

    // 只维护电压和电流，其他详细电池信息直接回调后广播出去，后端不维护
    float battery_voltage = 0.0;  // 电池电压
    uint8_t remaining_power = 0;  // 电池剩余电量
    uint8_t current_temp = 0;     // 电池当前温度，单位：摄氏度

    // 关节槽位：按产品 motor_count 初始化为空壳，收到 motor_health 后填健康字段
    std::vector<Joint> joints;
};

struct JoyIotState {
    std::atomic<bool> iot_joy_switch_;
    std::atomic<bool> web_joy_switch_;
};

// 机器人状态管理器（线程安全，仅维护状态缓存）
class RobotStateManager {
 public:
    static RobotStateManager& getInstance() {
        static RobotStateManager instance;
        return instance;
    }

    // 获取当前状态（只读）
    RobotState getState() {
        std::lock_guard<std::mutex> lock(mutex_);
        return state_;
    }

    // 设置状态
    void setStatus(const std::string& status) {
        std::lock_guard<std::mutex> lock(mutex_);
        state_.status = status;
    }

    // 按产品 motor_count 建立关节空槽（仅 id，无模拟健康/名称数据）
    void initJoints(size_t count) {
        std::lock_guard<std::mutex> lock(mutex_);
        state_.joints.assign(count, Joint{});
        for (size_t i = 0; i < count; ++i) {
            state_.joints[i].id = static_cast<int>(i);
        }
    }

    // 更新电机健康状态（只写已有槽位，数量由 initJoints/motor_count 决定）
    void updateMotorHealth(
        const std::vector<node_control_msgs::msg::MotorHealthState>&
            motor_health_states) {
        std::lock_guard<std::mutex> lock(mutex_);
        const size_t n =
            std::min(motor_health_states.size(), state_.joints.size());
        for (size_t index = 0; index < n; ++index) {
            const auto& joint = motor_health_states[index];
            state_.joints[index].health = joint.health();
            state_.joints[index].motor_direction = joint.motor_direction();
            state_.joints[index].motor_temperature = joint.motor_temperature();
            state_.joints[index].mos_temperature = joint.mos_temperature();
            state_.joints[index].bus_voltage = joint.bus_voltage();
            state_.joints[index].u1_online = joint.u1_online();
            state_.joints[index].position_zero = joint.position_zero();
            state_.joints[index].joint_version = joint.joint_version();
        }
    }

    // 更新从 lyos 话题接收到的状态（只更新缓存，不广播）
    void updateFromLyosState(
        const std::string& current_state, const std::string& current_mode,
        const std::string& current_action, const std::string& running_status,
        const uint16_t& motor_health, const float& battery_voltage,
        const uint8_t& remaining_power, const uint8_t& current_temp) {
        std::lock_guard<std::mutex> lock(mutex_);
        state_.connected = true;  // 标记连接
        state_.status = current_state;
        state_.mode = current_mode;
        state_.action = current_action;
        state_.running_status = running_status;
        state_.motor_health = motor_health == 0 ? "OK" : "ERROR";
        state_.battery_voltage = battery_voltage;
        state_.remaining_power = remaining_power;
        state_.current_temp = current_temp;
        last_message_time_ =
            std::chrono::steady_clock::now();  // 更新最后消息时间
    }

    // 获取最后消息时间（用于超时检测）
    std::chrono::steady_clock::time_point getLastMessageTime() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return last_message_time_;
    }

    // 获取消息超时时间
    static constexpr std::chrono::seconds getMessageTimeout() {
        return MESSAGE_TIMEOUT;
    }

    // 重置状态
    void reset() {
        std::lock_guard<std::mutex> lock(mutex_);
        state_.connected = false;
        state_.status = "Unknown";
        state_.mode = "Unknown";
        state_.action = "Unknown";
        state_.running_status = "Unknown";
        state_.motor_health = "Unknown";
        state_.battery_voltage = 0.0;
        state_.remaining_power = 0;
        state_.current_temp = 0;
    }

    // 更新状态（用于模拟或从 ROS2 接收）
    void updateState(const RobotState& new_state) {
        std::lock_guard<std::mutex> lock(mutex_);
        state_ = new_state;
    }

    void updateJoyIotState(const bool& iot_joy_switch,
                           const bool& web_joy_switch) {
        std::lock_guard<std::mutex> lock(mutex_);
        joy_iot_state_.iot_joy_switch_ = iot_joy_switch;
        joy_iot_state_.web_joy_switch_ = web_joy_switch;
    }
    void getJoyIotState(bool& iot_joy_switch, bool& web_joy_switch) {
        std::lock_guard<std::mutex> lock(mutex_);
        iot_joy_switch = joy_iot_state_.iot_joy_switch_;
        web_joy_switch = joy_iot_state_.web_joy_switch_;
    }

 private:
    RobotStateManager() {
        last_message_time_ = std::chrono::steady_clock::now();
    }
    ~RobotStateManager() = default;

    // 禁止拷贝
    RobotStateManager(const RobotStateManager&) = delete;
    RobotStateManager& operator=(const RobotStateManager&) = delete;

    RobotState state_;
    mutable std::mutex mutex_;
    std::chrono::steady_clock::time_point last_message_time_;
    JoyIotState joy_iot_state_;

    static constexpr std::chrono::seconds MESSAGE_TIMEOUT{5};  // 5秒超时
};

}  // namespace robot_monitor
