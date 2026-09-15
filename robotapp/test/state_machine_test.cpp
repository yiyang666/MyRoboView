#include "robotapp/state_machine.hpp"
#include <iostream>
void check(bool ok) {
    if (!ok) throw std::runtime_error("State machine assertion failed");
}
int main() {
    using State = node_app_msgs::msg::RobotState;
    auto idle = robotapp::state_at(0, 3, false);
    auto walk = robotapp::state_at(3, 3, false);
    auto turn = robotapp::state_at(6, 3, false);
    auto paused = robotapp::state_at(9, 3, false);
    auto again = robotapp::state_at(12, 3, false);
    auto fault = robotapp::state_at(1, 3, true);
    check(idle.running_status == State::IDLE && idle.current_mode == "STANDBY");
    check(walk.running_status == State::RUNNING &&
          walk.current_action == "WALK");
    check(turn.current_action == "TURN" &&
          paused.running_status == State::PAUSED);
    check(again.running_status == State::IDLE);
    check(fault.running_status == State::FAULT &&
          fault.motor_status == State::MOTOR_ERROR &&
          fault.current_action == "STOP");
    std::cout << "PASS robotapp timed states and fault override\n";
}
