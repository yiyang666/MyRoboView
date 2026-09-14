#include "robotapp/state_machine.hpp"
#include <node_app_msgs/msg/motor_health_array.hpp>
#include <sensor_msgs/msg/imu.hpp>
#include <rclcpp/rclcpp.hpp>
#include <ament_index_cpp/get_package_share_directory.hpp>
#include <json/json.h>
#include <fstream>
#include <iostream>
#include <set>

namespace {
void numeric(const Json::Value &v, double lo, double hi) {
  if (!v.isNumeric() || !std::isfinite(v.asDouble()) || v.asDouble() < lo || v.asDouble() > hi)
    throw std::invalid_argument("Invalid robotapp numeric configuration");
}
Json::Value config(const std::string &path) {
  std::ifstream f(path); Json::Value cfg; Json::CharReaderBuilder reader; std::string error;
  reader["rejectDupKeys"] = true; reader["failIfExtra"] = true;
  if (!f || !Json::parseFromStream(reader, f, &cfg, &error)) throw std::invalid_argument("Cannot parse robotapp config: " + error);
  if (!cfg["robot_id"].isString() || cfg["robot_id"].asString().empty() || cfg["robot_id"].asString().size() > 64)
    throw std::invalid_argument("Invalid robot_id");
  if (cfg["scenario"] != "nominal" && cfg["scenario"] != "fault") throw std::invalid_argument("Unknown scenario");
  numeric(cfg["state_step_sec"], 0.1, 60); numeric(cfg["motor_count"], 1, 64);
  if (!cfg["motor_count"].isUInt()) throw std::invalid_argument("motor_count must be integer");
  std::set<std::string> names;
  for (const auto *key : {"robot_state", "imu", "motor_health"}) {
    const auto &topic = cfg["topics"][key]; numeric(topic["hz"], 0.1, 500);
    if (!topic["name"].isString() || topic["name"].asString().empty() || topic["name"].asString()[0] != '/' || !names.insert(topic["name"].asString()).second)
      throw std::invalid_argument("Expected unique absolute topic names");
  }
  return cfg;
}
class RobotApp : public rclcpp::Node {
 public:
  explicit RobotApp(Json::Value cfg) : Node("robotapp"), cfg_(std::move(cfg)) {
    state_ = create_publisher<node_app_msgs::msg::RobotState>(name("robot_state"), rclcpp::QoS(10).reliable());
    imu_ = create_publisher<sensor_msgs::msg::Imu>(name("imu"), rclcpp::SensorDataQoS());
    motors_ = create_publisher<node_app_msgs::msg::MotorHealthArray>(name("motor_health"), rclcpp::QoS(10).reliable());
    timers_.push_back(create_wall_timer(period("robot_state"), [this] {
      auto msg = robotapp::state_at(elapsed(), cfg_["state_step_sec"].asDouble(), fault());
      msg.header.stamp = now(); msg.header.frame_id = "base_link"; msg.robot_id = cfg_["robot_id"].asString(); state_->publish(msg);
    }));
    timers_.push_back(create_wall_timer(period("imu"), [this] {
      sensor_msgs::msg::Imu msg; const double t = elapsed();
      msg.header.stamp = now(); msg.header.frame_id = "imu_link";
      msg.orientation.z = std::sin(t * 0.1); msg.orientation.w = std::cos(t * 0.1);
      msg.angular_velocity.z = 0.2; msg.linear_acceleration.z = 9.81;
      imu_->publish(msg);
    }));
    timers_.push_back(create_wall_timer(period("motor_health"), [this] {
      node_app_msgs::msg::MotorHealthArray msg; msg.header.stamp = now(); msg.header.frame_id = "base_link";
      msg.robot_id = cfg_["robot_id"].asString();
      for (unsigned i = 0; i < cfg_["motor_count"].asUInt(); ++i) {
        node_app_msgs::msg::MotorHealth m; m.motor_id = i; m.name = "motor_" + std::to_string(i);
        m.online = !(fault() && i == 0); m.direction = i % 2 ? m.REVERSE : m.FORWARD;
        m.temperature_celsius = fault() && i == 0 ? 85 : 32 + i + 2 * std::sin(elapsed() / 5);
        m.bus_voltage = 48.0; m.position_zero_rad = 0.01 * i; msg.motors.push_back(m);
      }
      motors_->publish(msg);
    }));
  }
 private:
  std::string name(const char *key) { return cfg_["topics"][key]["name"].asString(); }
  std::chrono::duration<double> period(const char *key) { return std::chrono::duration<double>(1 / cfg_["topics"][key]["hz"].asDouble()); }
  double elapsed() { return std::chrono::duration<double>(std::chrono::steady_clock::now() - start_).count(); }
  bool fault() { return cfg_["scenario"] == "fault"; }
  Json::Value cfg_;
  std::chrono::steady_clock::time_point start_ = std::chrono::steady_clock::now();
  rclcpp::Publisher<node_app_msgs::msg::RobotState>::SharedPtr state_;
  rclcpp::Publisher<sensor_msgs::msg::Imu>::SharedPtr imu_;
  rclcpp::Publisher<node_app_msgs::msg::MotorHealthArray>::SharedPtr motors_;
  std::vector<rclcpp::TimerBase::SharedPtr> timers_;
};
}
int main(int argc, char **argv) {
  try {
    std::string path = ament_index_cpp::get_package_share_directory("robotapp") + "/config/robotapp.json";
    if (argc == 3 && std::string(argv[1]) == "--config") path = argv[2];
    else if (argc != 1) throw std::invalid_argument("Usage: robotapp_node [--config PATH]");
    auto cfg = config(path); rclcpp::init(0, nullptr);
    auto node = std::make_shared<RobotApp>(cfg);
    std::cout << "robotapp: publishing RobotState, Imu, MotorHealthArray" << std::endl;
    rclcpp::spin(node); rclcpp::shutdown(); return 0;
  } catch (const std::exception &e) {
    std::cerr << "robotapp: " << e.what() << std::endl;
    if (rclcpp::ok()) rclcpp::shutdown();
    return 1;
  }
}
