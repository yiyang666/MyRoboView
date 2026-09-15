#include "roboview/core.hpp"
#include <ament_index_cpp/get_package_prefix.hpp>
#include <cmath>
#include <fstream>
#include <regex>
#include <set>
#include <stdexcept>

namespace roboview {
std::string encode(const Json::Value &value) {
    Json::StreamWriterBuilder writer;
    writer["indentation"] = "";
    return Json::writeString(writer, value);
}
namespace {
void require(bool ok, const std::string &message) {
    if (!ok) throw std::invalid_argument(message);
}
void number(const Json::Value &v, double low, double high,
            const std::string &name) {
    require(v.isNumeric() && std::isfinite(v.asDouble()) &&
                v.asDouble() >= low && v.asDouble() <= high,
            name + " outside allowed range");
}
void text(const Json::Value &v, size_t max, const std::string &name) {
    require(v.isString() && !v.asString().empty() && v.asString().size() <= max,
            "Invalid " + name);
}
}  // namespace
void validate_config(const Json::Value &cfg) {
    require(cfg["schema_version"].isInt() && cfg["schema_version"].asInt() == 2,
            "schema_version must be 2");
    text(cfg["robot"]["id"], 64, "robot.id");
    // robot 段以 type/product 标识机型与产品（原 name 字段已移除）
    text(cfg["robot"]["type"], 64, "robot.type");
    text(cfg["robot"]["product"], 64, "robot.product");
    const auto &server = cfg["server"];
    require(server["host"] == "127.0.0.1",
            "Demo listens on 127.0.0.1 only; use SSH forwarding");
    number(server["port"], 1024, 65535, "port");
    number(server["poll_ms"], 200, 5000, "poll_ms");
    require(server["port"].isUInt() && server["poll_ms"].isUInt(),
            "port/poll_ms must be integers");
    require(cfg["topics"].isArray() && cfg["topics"].size() > 0 &&
                cfg["topics"].size() <= 32,
            "Expected 1..32 topics");
    number(server["tick_ms"], 10, 100, "tick_ms");
    require(server["tick_ms"].isUInt(), "tick_ms must be integer");
    const auto &nav = cfg["navigation"];
    require(nav["enabled"].isBool(), "navigation.enabled must be boolean");
    number(nav["broadcast_hz"], 0.1, 1000.0 / server["tick_ms"].asDouble(),
           "navigation.broadcast_hz");
    number(nav["speed_mps"], 0.05, 10, "navigation.speed_mps");
    std::set<std::string> ids, names, events;
    for (const auto &t : cfg["topics"]) {
        text(t["id"], 32, "topic.id");
        text(t["topic"], 256, "topic.topic");
        text(t["type"], 256, "topic.type");
        const auto id = t["id"].asString(), name = t["topic"].asString();
        require(std::regex_match(id, std::regex("[a-z][a-z0-9_]*")) &&
                    ids.insert(id).second,
                "Invalid/duplicate topic id");
        require(std::regex_match(
                    name,
                    std::regex(
                        "/([A-Za-z_][A-Za-z0-9_]*/)*[A-Za-z_][A-Za-z0-9_]*")) &&
                    name.find("__") == std::string::npos &&
                    names.insert(name).second,
                "Invalid/duplicate ROS topic");
        require(std::regex_match(
                    t["type"].asString(),
                    std::regex("[a-z][a-z0-9_]*/msg/[A-Z][A-Za-z0-9]*")),
                "Expected package/msg/Message");
        text(t["label"], 256, "topic.label");
        number(t["stale_sec"], 0.1, 3600, "stale_sec");
        const auto &q = t["qos"];
        require(
            q["reliability"] == "reliable" || q["reliability"] == "best_effort",
            "Invalid reliability");
        require(q["durability"] == "volatile" ||
                    q["durability"] == "transient_local",
                "Invalid durability");
        number(q["depth"], 1, 100, "qos.depth");
        require(q["depth"].isUInt(), "depth must be integer");
        text(t["event"], 64, "event");
        require(events.insert(t["event"].asString()).second &&
                    t["event"] != "nav_state" && t["event"] != "hello" &&
                    t["event"] != "error",
                "Duplicate/reserved event");
        number(t["broadcast_hz"], 0.1, 1000.0 / server["tick_ms"].asDouble(),
               "broadcast_hz");
        require(t["metrics"].isArray() && t["metrics"].size() <= 16,
                "Expected at most 16 metrics");
        for (const auto &m : t["metrics"]) {
            text(m["label"], 256, "metric.label");
            text(m["field"], 256, "metric.field");
            require(
                std::regex_match(m["field"].asString(),
                                 std::regex("[A-Za-z_][A-Za-z0-9_]*(\\.([A-Za-"
                                            "z_][A-Za-z0-9_]*|[0-9]+))*")),
                "Invalid field path");
            require(!m.isMember("unit") || m["unit"].isString(),
                    "unit must be string");
            if (m.isMember("scale")) number(m["scale"], -1e6, 1e6, "scale");
        }
    }
}
Json::Value load_config(const std::string &path) {
    std::ifstream input(path);
    if (!input) throw std::runtime_error("Cannot open configuration: " + path);
    Json::CharReaderBuilder reader;
    reader["rejectDupKeys"] = true;
    reader["failIfExtra"] = true;
    Json::Value cfg;
    std::string error;
    if (!Json::parseFromStream(reader, input, &cfg, &error))
        throw std::invalid_argument(error);
    validate_config(cfg);
    return cfg;
}
rclcpp::QoS qos(const Json::Value &spec) {
    const auto &q = spec["qos"];
    auto result = rclcpp::QoS(rclcpp::KeepLast(q["depth"].asUInt()));
    if (q["reliability"] == "best_effort")
        result.best_effort();
    else
        result.reliable();
    if (q["durability"] == "transient_local")
        result.transient_local();
    else
        result.durability_volatile();
    return result;
}
std::string config_path(int argc, char **argv) {
    if (argc == 1)
        return ament_index_cpp::get_package_prefix("roboview") +
               "/etc/web_config/myroboview.json";
    if (argc == 3 && std::string(argv[1]) == "--config") return argv[2];
    throw std::invalid_argument("Usage: roboview [--config PATH]");
}
}  // namespace roboview
