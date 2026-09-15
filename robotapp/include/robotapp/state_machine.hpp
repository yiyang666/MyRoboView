#pragma once
#include <node_app_msgs/msg/robot_state.hpp>
#include <cmath>
#include <stdexcept>

namespace robotapp {
// Explicit timed demo state machine: IDLE -> WALK -> TURN -> PAUSED -> IDLE.
inline node_app_msgs::msg::RobotState state_at(double elapsed, double step,
                                               bool fault) {
    using State = node_app_msgs::msg::RobotState;
    if (!std::isfinite(elapsed) || elapsed < 0 || !std::isfinite(step) ||
        step <= 0)
        throw std::invalid_argument("Invalid state-machine time");
    State state;
    if (fault) {
        state.current_mode = "FAULT";
        state.current_action = "STOP";
        state.running_status = State::FAULT;
        state.motor_status = State::MOTOR_ERROR;
    } else {
        const int phase =
            static_cast<int>(std::fmod(std::floor(elapsed / step), 4));
        state.current_mode = phase == 0 ? "STANDBY" : "AUTO";
        state.current_action = phase == 1   ? "WALK"
                               : phase == 2 ? "TURN"
                                            : "HOLD";
        state.running_status = phase == 0   ? State::IDLE
                               : phase == 3 ? State::PAUSED
                                            : State::RUNNING;
        state.motor_status = State::MOTOR_OK;
    }
    state.battery_percentage =
        static_cast<float>(76 + 2 * std::sin(elapsed / 15));
    state.battery_voltage =
        static_cast<float>(48 + 0.3 * std::sin(elapsed / 10));
    return state;
}
}  // namespace robotapp
