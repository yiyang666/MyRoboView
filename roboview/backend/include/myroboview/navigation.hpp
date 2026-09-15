#pragma once
#include <json/json.h>
#include <mutex>
#include <stdexcept>
#include <string>
#include <vector>
#include <functional>

namespace myroboview {
struct NavError : std::runtime_error {
    int code;
    NavError(int code, const std::string &message)
        : std::runtime_error(message), code(code) {}
};
// In-memory simulation; validated actions also invoke the injected ROS command
// sink.
class Navigation {
 public:
    using CommandSink = std::function<void(
        const std::string &, const std::string &, const std::string &)>;
    Navigation(const std::string &fixture, double speed,
               CommandSink commands = {});
    Json::Value maps() const;
    Json::Value resources() const;
    Json::Value snapshot() const;
    Json::Value load_map(const Json::Value &body);
    Json::Value add_waypoint(const Json::Value &body);
    Json::Value delete_waypoint(const std::string &id);
    Json::Value add_route(const Json::Value &body);
    Json::Value delete_route(const std::string &id);
    Json::Value start(const Json::Value &body);
    Json::Value pause();
    Json::Value resume();
    Json::Value stop();
    Json::Value mapping_start(const Json::Value &body);
    Json::Value mapping_stop();
    Json::Value localize(const Json::Value &body, bool manual);
    void tick(double seconds);

 private:
    Json::Value state_unlocked() const;
    Json::Value point(const std::string &id) const;
    void reset_pose();
    Json::Value command(const std::string &category,
                        const std::string &function, const std::string &param);
    bool active() const {
        return status_ == "NAVIGATING" || status_ == "PAUSED";
    }
    mutable std::mutex mutex_;
    Json::Value fixture_;
    double speed_, x_ = 0, y_ = 0, yaw_ = 0;
    std::string status_ = "IDLE", route_id_;
    std::vector<Json::Value> path_;
    size_t index_ = 0;
    unsigned next_id_ = 1;
    CommandSink commands_;
    bool mapping_ = false;
    std::string mapping_name_;
};
}  // namespace myroboview
