#include "myroboview/core.hpp"
#include <cmath>

namespace myroboview {
StateStore::StateStore(Json::Value config) : config_(std::move(config)) {
  for (const auto &t : config_["topics"]) entries_.emplace(t["id"].asString(), Entry{});
}
void StateStore::update(const std::string &id, Json::Value data, Clock::time_point now) {
  std::lock_guard<std::mutex> lock(mutex_);
  auto &e = entries_.at(id);
  e.data = std::move(data); e.error.clear(); ++e.count;
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
  result["schema_version"] = 1; result["transport"] = "ros2";
  result["robot"] = config_["robot"]; result["poll_ms"] = config_["server"]["poll_ms"];
  result["topics"] = Json::Value(Json::arrayValue);
  for (auto t : config_["topics"]) {
    t.removeMember("mock");
    const auto &e = entries_.at(t["id"].asString());
    double age = e.times.empty() ? -1 : std::chrono::duration<double>(now - e.times.back()).count();
    std::string state = !e.error.empty() ? "error" : age < 0 ? "waiting" : age > t["stale_sec"].asDouble() ? "stale" : "live";
    double hz = 0;
    auto first = e.times.begin();
    while (first != e.times.end() && std::chrono::duration<double>(now - *first).count() > 5) ++first;
    if (state == "live" && std::distance(first, e.times.end()) > 1) {
      double span = std::chrono::duration<double>(e.times.back() - *first).count();
      if (span > 0) hz = (std::distance(first, e.times.end()) - 1) / span;
    }
    t["state"] = state; t["age_sec"] = age < 0 ? Json::Value() : Json::Value(std::round(age * 1000) / 1000);
    t["hz"] = std::round(hz * 10) / 10; t["count"] = Json::UInt64(e.count);
    t["error"] = e.error.empty() ? Json::Value() : Json::Value(e.error); t["data"] = e.data;
    result["topics"].append(std::move(t));
  }
  return result;
}
}  // namespace myroboview
