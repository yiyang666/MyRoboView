#pragma once
#include <node_app_msgs/msg/robot_state.hpp>
#include <cmath>
#include <cstdint>
#include <stdexcept>

namespace robotapp {
// 显式节拍 demo 状态机：IDLE -> 动作A -> 动作B -> PAUSED -> IDLE 循环。
// 动作按机器人类型差异化（两套 mock 的核心差异）：
//   人形 humanoid          -> WALK + WAVE（挥手）
//   四足轮式 quadruped     -> WALK + RUN（奔跑）
inline node_app_msgs::msg::RobotState state_at(double elapsed, double step,
                                               bool fault,
                                               std::uint8_t robot_type) {
    using State = node_app_msgs::msg::RobotState;
    if (!std::isfinite(elapsed) || elapsed < 0 || !std::isfinite(step) ||
        step <= 0)
        throw std::invalid_argument("Invalid state-machine time");
    State state;
    if (fault) {
        state.current_mode = State::MODE_DISABLED;
        state.current_action = State::ACTION_IDLE;
        state.running_status = State::STATUS_FAULT;
        state.motor_overall_status = State::MOTOR_ERROR;
    } else {
        const int phase =
            static_cast<int>(std::fmod(std::floor(elapsed / step), 4));
        state.current_mode =
            phase == 0 ? State::MODE_READY : State::MODE_MOTION;
        const bool humanoid = robot_type == State::TYPE_HUMANOID;
        state.current_action =
            phase == 1   ? State::ACTION_WALK
            : phase == 2 ? (humanoid ? State::ACTION_WAVE : State::ACTION_RUN)
                         : State::ACTION_IDLE;
        state.running_status = phase == 0   ? State::STATUS_IDLE
                               : phase == 3 ? State::STATUS_PAUSED
                                            : State::STATUS_RUNNING;
        state.motor_overall_status = State::MOTOR_OK;
    }
    state.battery_percentage =
        static_cast<float>(76 + 2 * std::sin(elapsed / 15));
    state.battery_voltage =
        static_cast<float>(48 + 0.3 * std::sin(elapsed / 10));
    state.battery_temperature =
        static_cast<float>(30 + 2 * std::sin(elapsed / 20));
    return state;
}
}  // namespace robotapp
