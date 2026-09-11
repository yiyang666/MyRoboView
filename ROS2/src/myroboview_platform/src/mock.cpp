#include "myroboview/core.hpp"
#include <myroboview_interfaces/msg/platform_status.hpp>
#include <sensor_msgs/msg/battery_state.hpp>
#include <sensor_msgs/msg/imu.hpp>
#include <sensor_msgs/msg/joint_state.hpp>
#include <nav_msgs/msg/odometry.hpp>
#include <cmath>
#include <iostream>

namespace myroboview {
using Status = myroboview_interfaces::msg::PlatformStatus;
using Battery = sensor_msgs::msg::BatteryState;
using Imu = sensor_msgs::msg::Imu;
using Joints = sensor_msgs::msg::JointState;
using Odom = nav_msgs::msg::Odometry;
void fill(Status &m, double t, bool warning) {
  m.header.frame_id = "base_link";
  m.level = warning ? Status::WARN : Status::OK;
  m.mode = warning ? "mock_warning" : "mock_nominal";
  m.cpu_percent = warning ? 88 : 24 + 6 * std::sin(t / 3);
  m.memory_percent = 36 + 2 * std::sin(t / 5); m.uptime_sec = static_cast<uint64_t>(t);
  m.summary = warning ? "Synthetic CPU load warning" : "Synthetic telemetry; no hardware connected";
}
void fill(Battery &m, double t, bool warning) {
  m.header.frame_id = "base_link"; m.percentage = warning ? 0.15 : 0.76 + 0.03 * std::sin(t / 10);
  m.voltage = 24.2; m.current = -1.8; m.temperature = 31; m.present = true;
  m.power_supply_status = Battery::POWER_SUPPLY_STATUS_DISCHARGING;
}
void fill(Imu &m, double t, bool) {
  m.header.frame_id = "imu_link"; m.orientation.z = std::sin(t * 0.1); m.orientation.w = std::cos(t * 0.1);
  m.angular_velocity.z = 0.2; m.linear_acceleration.z = 9.81;
}
void fill(Joints &m, double t, bool) {
  m.header.frame_id = "base_link"; m.name = {"left_wheel_joint", "right_wheel_joint"};
  m.position = {t * 1.2, t * 1.5}; m.velocity = {1.2, 1.5}; m.effort = {0.2, 0.25};
}
void fill(Odom &m, double t, bool) {
  m.header.frame_id = "odom"; m.child_frame_id = "base_link";
  m.pose.pose.position.x = 2 * std::cos(t * 0.2); m.pose.pose.position.y = 2 * std::sin(t * 0.2);
  // Heading follows the tangent of the circular path.
  double heading = t * 0.2 + std::acos(-1.0) / 2;
  m.pose.pose.orientation.z = std::sin(heading / 2); m.pose.pose.orientation.w = std::cos(heading / 2);
  m.twist.twist.linear.x = 0.4; m.twist.twist.angular.z = 0.2;
}
class MockRobot : public rclcpp::Node {
 public:
  MockRobot(const Json::Value &cfg, bool warning) : Node("myroboview_mock"), robot_id_(cfg["robot"]["id"].asString()), warning_(warning) {
    const std::map<std::string, std::string> kinds{
      {"status", "myroboview_interfaces/msg/PlatformStatus"}, {"battery", "sensor_msgs/msg/BatteryState"},
      {"imu", "sensor_msgs/msg/Imu"}, {"joints", "sensor_msgs/msg/JointState"}, {"odom", "nav_msgs/msg/Odometry"}};
    for (const auto &s : cfg["topics"]) {
      if (!s.isMember("mock")) continue;
      auto kind = s["mock"]["kind"].asString();
      if (!kinds.count(kind) || kinds.at(kind) != s["type"].asString()) throw std::invalid_argument("Mock kind/type mismatch: " + s["id"].asString());
    }
    for (const auto &s : cfg["topics"]) {
      if (!s.isMember("mock")) continue;
      auto kind = s["mock"]["kind"].asString();
      if (kind == "status") add<Status>(s);
      else if (kind == "battery") add<Battery>(s);
      else if (kind == "imu") add<Imu>(s);
      else if (kind == "joints") add<Joints>(s);
      else if (kind == "odom") add<Odom>(s);
    }
    if (timers_.empty()) throw std::invalid_argument("No mock generators in config");
  }
 private:
  template<class T> void add(const Json::Value &spec) {
    auto publisher = create_publisher<T>(spec["topic"].asString(), qos(spec));
    auto timer = create_wall_timer(std::chrono::duration<double>(1 / spec["mock"]["hz"].asDouble()), [this, publisher] {
      T message;
      fill(message, std::chrono::duration<double>(Clock::now() - started_).count(), warning_);
      if constexpr (std::is_same_v<T, Status>) message.robot_id = robot_id_;
      message.header.stamp = now(); publisher->publish(message);
    });
    publishers_.push_back(publisher); timers_.push_back(timer);
  }
  Clock::time_point started_ = Clock::now();
  std::string robot_id_;
  bool warning_;
  std::vector<rclcpp::PublisherBase::SharedPtr> publishers_;
  std::vector<rclcpp::TimerBase::SharedPtr> timers_;
};
}
int main(int argc, char **argv) {
  try {
    auto opts = myroboview::options(argc, argv, true);
    auto cfg = myroboview::load_config(opts.config);
    rclcpp::init(0, nullptr);
    auto node = std::make_shared<myroboview::MockRobot>(cfg, opts.scenario == "warning");
    std::cout << "C++ Mock: " << cfg["robot"]["id"].asString() << " / " << opts.scenario << std::endl;
    rclcpp::spin(node); rclcpp::shutdown(); return 0;
  } catch (const std::exception &e) {
    std::cerr << "mock: " << e.what() << std::endl;
    if (rclcpp::ok()) rclcpp::shutdown();
    return 1;
  }
}
