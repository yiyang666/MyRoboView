#include "robotapp/state_machine.hpp"
#include <iostream>
void check(bool ok, const char *message) {
    if (!ok) throw std::runtime_error(message);
}
int main() {
    using State = node_app_msgs::msg::RobotState;
    constexpr auto HUMANOID = State::TYPE_HUMANOID;
    constexpr auto QUADRUPED = State::TYPE_QUADRUPED_WHEELED;
    auto idle = robotapp::state_at(0, 3, false, HUMANOID);
    auto walk = robotapp::state_at(3, 3, false, HUMANOID);
    auto wave = robotapp::state_at(6, 3, false, HUMANOID);
    auto run = robotapp::state_at(6, 3, false, QUADRUPED);
    auto paused = robotapp::state_at(9, 3, false, HUMANOID);
    auto again = robotapp::state_at(12, 3, false, HUMANOID);
    auto fault = robotapp::state_at(1, 3, true, HUMANOID);
    check(idle.running_status == State::STATUS_IDLE &&
              idle.current_mode == State::MODE_READY,
          "idle phase");
    check(walk.running_status == State::STATUS_RUNNING &&
              walk.current_action == State::ACTION_WALK &&
              walk.current_mode == State::MODE_MOTION,
          "walk phase");
    // 差异化断言：同一节拍，人形挥手、四足轮式奔跑
    check(wave.current_action == State::ACTION_WAVE, "humanoid waves");
    check(run.current_action == State::ACTION_RUN, "quadruped runs");
    check(paused.running_status == State::STATUS_PAUSED, "paused phase");
    check(again.running_status == State::STATUS_IDLE, "cycle wraps");
    check(fault.running_status == State::STATUS_FAULT &&
              fault.motor_overall_status == State::MOTOR_ERROR &&
              fault.current_action == State::ACTION_IDLE &&
              fault.current_mode == State::MODE_DISABLED,
          "fault override");
    std::cout << "PASS robotapp timed states, product actions and fault override\n";
}
