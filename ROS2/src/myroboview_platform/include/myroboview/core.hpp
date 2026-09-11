#pragma once
#include <json/json.h>
#include <rclcpp/rclcpp.hpp>
#include <chrono>
#include <deque>
#include <map>
#include <mutex>
#include <string>

namespace myroboview {
using Clock = std::chrono::steady_clock;
std::string encode(const Json::Value &value);
Json::Value load_config(const std::string &path);
void validate_config(const Json::Value &cfg);
rclcpp::QoS qos(const Json::Value &spec);
struct Options {
  std::string config;
  std::string scenario = "nominal";
};
Options options(int argc, char **argv, bool mock = false);
class StateStore {
 public:
  explicit StateStore(Json::Value config);
  void update(const std::string &id, Json::Value data, Clock::time_point now = Clock::now());
  void reject(const std::string &id, const std::string &error);
  Json::Value snapshot(Clock::time_point now = Clock::now()) const;
 private:
  struct Entry {
    Json::Value data;
    std::deque<Clock::time_point> times;
    uint64_t count = 0;
    std::string error;
  };
  Json::Value config_;
  mutable std::mutex mutex_;
  std::map<std::string, Entry> entries_;
};
}  // namespace myroboview
