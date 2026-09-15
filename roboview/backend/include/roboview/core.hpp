#pragma once
#include <json/json.h>
#include <rclcpp/rclcpp.hpp>
#include <chrono>
#include <deque>
#include <map>
#include <mutex>
#include <string>

namespace roboview {
using Clock = std::chrono::steady_clock;
std::string encode(const Json::Value &value);
Json::Value load_config(const std::string &path);
void validate_config(const Json::Value &cfg);
rclcpp::QoS qos(const Json::Value &spec);
std::string config_path(int argc, char **argv);
class StateStore {
 public:
    explicit StateStore(Json::Value config);
    void update(const std::string &id, Json::Value data,
                Clock::time_point now = Clock::now());
    void reject(const std::string &id, const std::string &error);
    std::vector<Json::Value> due_frames(Clock::time_point now = Clock::now());
    Json::Value snapshot(Clock::time_point now = Clock::now()) const;

 private:
    struct Entry {
        Json::Value data;
        std::deque<Clock::time_point> times;
        uint64_t count = 0;
        std::string error;
        Clock::time_point last_emit{};
    };
    Json::Value config_;
    mutable std::mutex mutex_;
    std::map<std::string, Entry> entries_;
};
}  // namespace roboview
