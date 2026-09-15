#include "myroboview/navigation.hpp"
#include <algorithm>
#include <cmath>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <locale>

namespace myroboview {
namespace {
Json::Value ok() {
    Json::Value v;
    v["success"] = true;
    return v;
}
std::string text(const Json::Value &v, const char *key) {
    if (!v[key].isString() || v[key].asString().empty() ||
        v[key].asString().size() > 128)
        throw NavError(400, std::string("Invalid ") + key);
    return v[key].asString();
}
double coordinate(const Json::Value &v, const char *key, double lo, double hi) {
    if (!v[key].isNumeric() || !std::isfinite(v[key].asDouble()) ||
        v[key].asDouble() < lo || v[key].asDouble() > hi)
        throw NavError(400, std::string("Invalid ") + key);
    return v[key].asDouble();
}
}  // namespace
Navigation::Navigation(const std::string &fixture, double speed,
                       CommandSink commands)
    : speed_(speed), commands_(std::move(commands)) {
    std::ifstream f(fixture);
    Json::CharReaderBuilder reader;
    std::string error;
    if (!f || !Json::parseFromStream(reader, f, &fixture_, &error) ||
        !fixture_["waypoints"].isArray() || fixture_["waypoints"].empty())
        throw std::runtime_error("Cannot load bundled navigation fixture: " +
                                 error);
    reset_pose();
}
Json::Value Navigation::command(const std::string &category,
                                const std::string &function,
                                const std::string &param) {
    if (commands_) commands_(category, function, param);
    auto result = ok();
    result["published"] = bool(commands_);
    result["topic"] = "/iot/command";
    result["command"]["category"] = category;
    result["command"]["fun_name"] = function;
    result["command"]["sub"] = "";
    result["command"]["param"] = param;
    return result;
}
void Navigation::reset_pose() {
    const auto &p = fixture_["waypoints"][0];
    x_ = p["x"].asDouble();
    y_ = p["y"].asDouble();
    yaw_ = p["yaw"].asDouble();
}
Json::Value Navigation::point(const std::string &id) const {
    for (const auto &p : fixture_["waypoints"])
        if (p["id"] == id) return p;
    throw NavError(404, "Unknown waypoint");
}
Json::Value Navigation::maps() const {
    std::lock_guard<std::mutex> lock(mutex_);
    auto v = ok();
    v["loaded_map_id"] = fixture_["map"]["id"];
    v["maps"] = Json::Value(Json::arrayValue);
    v["maps"].append(fixture_["map"]);
    return v;
}
Json::Value Navigation::resources() const {
    std::lock_guard<std::mutex> lock(mutex_);
    auto v = fixture_;
    v["success"] = true;
    v["loaded_map_id"] = fixture_["map"]["id"];
    return v;
}
Json::Value Navigation::state_unlocked() const {
    Json::Value v;
    v["source"] = "demo";
    v["connected"] = true;
    v["map_name"] = fixture_["map"]["name"];
    v["loaded_map_id"] = fixture_["map"]["id"];
    v["active_route_id"] = active() ? route_id_ : "";
    v["current_waypoint_id"] = active() && index_ < path_.size()
                                   ? path_[index_]["id"]
                                   : Json::Value("");
    v["status"] = status_;
    v["route_paused"] = status_ == "PAUSED";
    v["task"] = active()                 ? "NAV_START"
                : status_ == "SUCCEEDED" ? "NAV_OK"
                : status_ == "CANCELED"  ? "NAV_STOP"
                                         : "IDLE";
    if (mapping_) v["task"] = "MAP_BUILD";
    v["mapping"]["active"] = mapping_;
    v["mapping"]["name"] = mapping_name_;
    v["localized"] = true;
    v["loc_fitness"] = 1.0;
    v["pose"]["x"] = x_;
    v["pose"]["y"] = y_;
    v["pose"]["yaw"] = yaw_;
    v["pose"]["z"] = 0.;
    v["pose"]["roll"] = 0.;
    v["pose"]["pitch"] = 0.;
    v["twist"]["linear"] = status_ == "NAVIGATING" ? speed_ : 0.;
    v["twist"]["angular"] = 0.;
    v["distance_to_goal"] = active() && index_ < path_.size()
                                ? std::hypot(path_[index_]["x"].asDouble() - x_,
                                             path_[index_]["y"].asDouble() - y_)
                                : 0.;
    v["completed_waypoints"] = Json::UInt64(index_);
    v["total_waypoints"] = Json::UInt64(path_.size());
    return v;
}
Json::Value Navigation::snapshot() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return state_unlocked();
}
Json::Value Navigation::load_map(const Json::Value &body) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (text(body, "map_id") != fixture_["map"]["id"].asString())
        throw NavError(404, "Unknown demo map");
    if (active() || mapping_)
        throw NavError(409, "Stop navigation and mapping before loading a map");
    auto result = command("MAP", "LOAD", fixture_["map"]["name"].asString());
    reset_pose();
    path_.clear();
    index_ = 0;
    status_ = "IDLE";
    route_id_.clear();
    return result;
}
Json::Value Navigation::add_waypoint(const Json::Value &body) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (text(body, "map_id") != fixture_["map"]["id"].asString())
        throw NavError(404, "Unknown map");
    if (fixture_["waypoints"].size() >= 256)
        throw NavError(409, "Waypoint limit reached");
    Json::Value p;
    p["name"] = text(body, "name");
    p["x"] = coordinate(body, "x", 0, fixture_["map"]["width"].asDouble());
    p["y"] = coordinate(body, "y", 0, fixture_["map"]["height"].asDouble());
    p["yaw"] = coordinate(body, "yaw", -std::acos(-1.), std::acos(-1.));
    p["id"] = "wp-created-" + std::to_string(next_id_++);
    p["map_id"] = fixture_["map"]["id"];
    fixture_["waypoints"].append(p);
    auto result = ok();
    result["waypoint"] = p;
    return result;
}
Json::Value Navigation::delete_waypoint(const std::string &id) {
    std::lock_guard<std::mutex> lock(mutex_);
    point(id);
    for (const auto &route : fixture_["routes"])
        for (const auto &key : route["waypoint_ids"])
            if (key == id)
                throw NavError(409, "Waypoint is referenced by a route");
    for (Json::ArrayIndex i = 0; i < fixture_["waypoints"].size(); ++i)
        if (fixture_["waypoints"][i]["id"] == id) {
            fixture_["waypoints"].removeIndex(i, nullptr);
            break;
        }
    return ok();
}
Json::Value Navigation::add_route(const Json::Value &body) {
    std::lock_guard<std::mutex> lock(mutex_);
    Json::Value r;
    r["name"] = text(body, "name");
    const auto &ids = body["waypoint_ids"];
    if (!ids.isArray() || ids.empty() || ids.size() > 128)
        throw NavError(400, "Expected 1..128 waypoint_ids");
    if (fixture_["routes"].size() >= 128)
        throw NavError(409, "Route limit reached");
    for (const auto &id : ids) {
        if (!id.isString()) throw NavError(400, "Invalid waypoint ID");
        point(id.asString());
    }
    r["waypoint_ids"] = ids;
    r["map_id"] = fixture_["map"]["id"];
    r["id"] = "route-created-" + std::to_string(next_id_++);
    fixture_["routes"].append(r);
    auto v = ok();
    v["route"] = r;
    return v;
}
Json::Value Navigation::delete_route(const std::string &id) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (active() && route_id_ == id) throw NavError(409, "Route is active");
    for (Json::ArrayIndex i = 0; i < fixture_["routes"].size(); ++i)
        if (fixture_["routes"][i]["id"] == id) {
            fixture_["routes"].removeIndex(i, nullptr);
            return ok();
        }
    throw NavError(404, "Unknown route");
}
Json::Value Navigation::start(const Json::Value &body) {
    std::lock_guard<std::mutex> lock(mutex_);
    const auto id = text(body, "route_id");
    if (active() || mapping_)
        throw NavError(409, "Navigation or mapping is already active");
    for (const auto &r : fixture_["routes"])
        if (r["id"] == id) {
            std::vector<Json::Value> path;
            for (const auto &p : r["waypoint_ids"])
                path.push_back(point(p.asString()));
            if (path.empty()) throw NavError(400, "Empty route");
            std::ostringstream param;
            param.imbue(std::locale::classic());
            param << std::fixed << std::setprecision(6);
            for (size_t i = 0; i < path.size(); ++i) {
                if (i) param << ';';
                param << path[i]["x"].asDouble() << ','
                      << path[i]["y"].asDouble() << ','
                      << path[i]["yaw"].asDouble();
            }
            auto result = command("NAV", "START", param.str());
            path_ = std::move(path);
            index_ = 0;
            route_id_ = id;
            status_ = "NAVIGATING";
            return result;
        }
    throw NavError(404, "Unknown route");
}
Json::Value Navigation::pause() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (status_ != "NAVIGATING") throw NavError(409, "No running demo route");
    auto result = command("NAV", "PAUSE", "");
    status_ = "PAUSED";
    return result;
}
Json::Value Navigation::resume() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (status_ != "PAUSED") throw NavError(409, "No paused demo route");
    auto result = command("NAV", "RESUME", "");
    status_ = "NAVIGATING";
    return result;
}
Json::Value Navigation::stop() {
    std::lock_guard<std::mutex> lock(mutex_);
    auto result = command("NAV", "STOP", "");
    if (active()) status_ = "CANCELED";
    return result;
}
Json::Value Navigation::mapping_start(const Json::Value &body) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (active() || mapping_)
        throw NavError(409, "Navigation or mapping is already active");
    auto name = text(body, "map_name");
    if (name.find_first_of("/\\,;\r\n\t") != std::string::npos ||
        name.find_first_not_of(' ') == std::string::npos)
        throw NavError(400, "Invalid map_name");
    auto result = command("MAP", "START", "online," + name);
    mapping_ = true;
    mapping_name_ = name;
    return result;
}
Json::Value Navigation::mapping_stop() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!mapping_) throw NavError(409, "Mapping is not active");
    auto result = command("MAP", "STOP", "");
    mapping_ = false;
    return result;
}
Json::Value Navigation::localize(const Json::Value &body, bool manual) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (active() || mapping_)
        throw NavError(409, "Stop navigation and mapping before localization");
    double x = x_, y = y_, yaw = yaw_;
    std::ostringstream param;
    param.imbue(std::locale::classic());
    if (manual) {
        x = coordinate(body, "x", 0, fixture_["map"]["width"].asDouble());
        y = coordinate(body, "y", 0, fixture_["map"]["height"].asDouble());
        yaw = coordinate(body, "yaw", -std::acos(-1.), std::acos(-1.));
        param << std::fixed << std::setprecision(6) << x << ',' << y << ','
              << yaw;
    }
    auto result = command("LOC", "START", param.str());
    x_ = x;
    y_ = y;
    yaw_ = yaw;
    return result;
}
void Navigation::tick(double seconds) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (status_ != "NAVIGATING" || !std::isfinite(seconds) || seconds <= 0)
        return;
    double budget = speed_ * std::min(seconds, 0.25);
    while (index_ < path_.size()) {
        const auto &p = path_[index_];
        double dx = p["x"].asDouble() - x_, dy = p["y"].asDouble() - y_;
        const double distance = std::hypot(dx, dy);
        if (distance <= budget) {
            x_ = p["x"].asDouble();
            y_ = p["y"].asDouble();
            yaw_ = p["yaw"].asDouble();
            budget -= distance;
            ++index_;
        } else {
            x_ += dx * budget / distance;
            y_ += dy * budget / distance;
            yaw_ = std::atan2(dy, dx);
            break;
        }
    }
    if (index_ == path_.size()) status_ = "SUCCEEDED";
}
}  // namespace myroboview
