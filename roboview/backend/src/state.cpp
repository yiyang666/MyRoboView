#include "roboview/core.hpp"
#include <cmath>

namespace roboview {
StateStore::StateStore(Json::Value config) : config_(std::move(config)) {
    for (const auto &t : config_["topics"])
        entries_.emplace(t["id"].asString(), Entry{});
}
void StateStore::update(const std::string &id, Json::Value data,
                        Clock::time_point now) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto &e = entries_.at(id);
    e.data = std::move(data);
    e.error.clear();
    ++e.count;
    e.times.push_back(now);
    if (e.times.size() > 100) e.times.pop_front();
}
void StateStore::reject(const std::string &id, const std::string &error) {
    std::lock_guard<std::mutex> lock(mutex_);
    entries_.at(id).error = error;
}
Json::Value StateStore::snapshot(Clock::time_point now) const {
    std::lock_guard<std::mutex> lock(mutex_);
    Json::Value result;
    result["schema_version"] = 2;
    result["transport"] = "ros2";
    result["robot"] = config_["robot"];
    result["poll_ms"] = config_["server"]["poll_ms"];
    result["topics"] = Json::Value(Json::arrayValue);
    for (auto t : config_["topics"]) {
        t.removeMember("mock");
        const auto &e = entries_.at(t["id"].asString());
        double age =
            e.times.empty()
                ? -1
                : std::chrono::duration<double>(now - e.times.back()).count();
        std::string state = !e.error.empty()                  ? "error"
                            : age < 0                         ? "waiting"
                            : age > t["stale_sec"].asDouble() ? "stale"
                                                              : "live";
        double hz = 0;
        auto first = e.times.begin();
        while (first != e.times.end() &&
               std::chrono::duration<double>(now - *first).count() > 5)
            ++first;
        if (state == "live" && std::distance(first, e.times.end()) > 1) {
            double span =
                std::chrono::duration<double>(e.times.back() - *first).count();
            if (span > 0) hz = (std::distance(first, e.times.end()) - 1) / span;
        }
        t["state"] = state;
        t["age_sec"] = age < 0 ? Json::Value()
                               : Json::Value(std::round(age * 1000) / 1000);
        t["hz"] = std::round(hz * 10) / 10;
        t["count"] = Json::UInt64(e.count);
        t["error"] = e.error.empty() ? Json::Value() : Json::Value(e.error);
        t["data"] = e.data;
        result["topics"].append(std::move(t));
    }
    return result;
}
std::vector<Json::Value> StateStore::due_frames(Clock::time_point now) {
    const auto state = snapshot(now);
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<Json::Value> frames;
    for (const auto &topic : state["topics"]) {
        auto &entry = entries_.at(topic["id"].asString());
        const double period = 1.0 / topic["broadcast_hz"].asDouble();
        if (entry.last_emit != Clock::time_point{} &&
            std::chrono::duration<double>(now - entry.last_emit).count() +
                    1e-9 <
                period)
            continue;
        entry.last_emit = now;
        Json::Value frame;
        frame["schema_version"] = 2;
        frame["type"] = topic["event"];
        frame["topic_id"] = topic["id"];
        frame["topic"] = topic["topic"];
        frame["state"] = topic["state"];
        frame["age_sec"] = topic["age_sec"];
        frame["received_count"] = topic["count"];
        frame["receive_hz"] = topic["hz"];
        frame["error"] = topic["error"];
        frame["data"] = topic["data"];
        frames.push_back(std::move(frame));
    }
    return frames;
}
}  // namespace roboview
