#include "myroboview/core.hpp"
#include "myroboview/introspection.hpp"
#include <myroboview_interfaces/msg/platform_status.hpp>
#include <sensor_msgs/msg/battery_state.hpp>
#include <sensor_msgs/msg/joint_state.hpp>
#include <nav_msgs/msg/odometry.hpp>
#include <std_msgs/msg/u_int64.hpp>
#include <limits>
#include <iostream>
#include <stdexcept>

void check(bool passed, const char *message) { if (!passed) throw std::runtime_error(message); }
template<class T> Json::Value decode(const std::string &type, const T &message) {
  rclcpp::SerializedMessage wire;
  rclcpp::Serialization<T> serializer; serializer.serialize_message(&message, &wire);
  return myroboview::Decoder(type).decode(wire);
}
int main(int argc, char **argv) {
  try {
    check(argc == 2, "config path required");
    auto config = myroboview::load_config(argv[1]);
    for (int fault = 0; fault < 6; ++fault) {
      auto bad = config;
      if (fault == 0) bad["topics"][1]["id"] = bad["topics"][0]["id"];
      if (fault == 1) bad["topics"][0]["qos"]["depth"] = 0;
      if (fault == 2) bad["topics"][0]["qos"]["reliability"] = "typo";
      if (fault == 3) bad["topics"][0]["stale_sec"] = -1;
      if (fault == 4) bad["server"]["host"] = "0.0.0.0";
      if (fault == 5) bad["topics"][0]["topic"] = "/bad//name";
      bool rejected = false;
      try { myroboview::validate_config(bad); } catch (const std::exception &) { rejected = true; }
      check(rejected, "bad config was accepted");
    }
    myroboview::StateStore state(config);
    auto t = myroboview::Clock::now();
    check(state.snapshot(t)["topics"][0]["state"] == "waiting", "initial data must be waiting");
    state.update("status", Json::Value(1), t);
    state.update("status", Json::Value(2), t + std::chrono::milliseconds(500));
    auto s = state.snapshot(t + std::chrono::seconds(1));
    check(s["topics"][0]["hz"].asDouble() == 2, "frequency measurement");
    check(s["topics"][1]["state"] == "waiting", "freshness must be per topic");
    s = state.snapshot(t + std::chrono::seconds(4));
    check(s["topics"][0]["state"] == "stale" && s["topics"][0]["hz"].asDouble() == 0, "stale data must not report live Hz");
    state.reject("status", "oversize"); check(state.snapshot()["topics"][0]["state"] == "error", "decode error surfaced");
    state.update("status", Json::Value(3)); check(state.snapshot()["topics"][0]["state"] == "live", "recovery clears error");
    sensor_msgs::msg::BatteryState battery; battery.voltage = std::numeric_limits<float>::quiet_NaN(); battery.present = true;
    auto b = decode("sensor_msgs/msg/BatteryState", battery);
    check(b["voltage"].isNull() && b["present"].asBool(), "NaN normalization and boolean conversion");
    sensor_msgs::msg::JointState joints; joints.name = {"left", "right"}; joints.position = {1.0, 2.0};
    auto j = decode("sensor_msgs/msg/JointState", joints);
    check(j["name"][1] == "right" && j["position"][0].asDouble() == 1, "sequence introspection");
    nav_msgs::msg::Odometry odom; odom.pose.pose.position.x = 2.5;
    auto o = decode("nav_msgs/msg/Odometry", odom);
    check(o["pose"]["pose"]["position"]["x"].asDouble() == 2.5 && o["pose"]["covariance"].size() == 36, "nested fields and fixed arrays");
    myroboview_interfaces::msg::PlatformStatus status; status.robot_id = "custom-01"; status.level = 1;
    auto p = decode("myroboview_interfaces/msg/PlatformStatus", status);
    check(p["robot_id"] == "custom-01" && p["level"].asInt() == 1, "custom interface conversion");
    std_msgs::msg::UInt64 large; large.data = std::numeric_limits<uint64_t>::max();
    check(decode("std_msgs/msg/UInt64", large)["data"] == "18446744073709551615", "browser integer precision");
    joints.position.resize(9000, 1.0);
    bool rejected = false;
    try { decode("sensor_msgs/msg/JointState", joints); } catch (const std::exception &) { rejected = true; }
    check(rejected, "unbounded arrays must be rejected");
    std::cout << "PASS: config, freshness, recovery, standard/custom introspection and bounds" << std::endl;
    return 0;
  } catch (const std::exception &e) { std::cerr << e.what() << std::endl; return 1; }
}
