#include "nav_manager.h"
#include "nav_map_io.h"
#include "robot_state.h"

#include <algorithm>
#include <cmath>
#include <filesystem>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <thread>

#include <nav_msgs/msg/OccupancyGrid.h>
#include <nav_msgs/msg/Path.h>

#include "websocket_handler.h"
#include "view_config.h"

namespace robot_monitor {

namespace {
// 建图收尾扫盘窗口（配合离开 MAP_BUILD 后再扫）
constexpr int kMappingScanRetries = 40;  // 40 × 500ms ≈ 20s

std::string offlineMapsRoot() {
    return ViewConfigManager::getInstance()
        .getConfig()
        .localMapsPathOrDefault();
}

/** 将单个离线目录解析为 MapInfo；失败返回 nullopt */
std::optional<MapInfo> parseOfflineMapDir(const std::filesystem::path& dir) {
    namespace fs = std::filesystem;
    if (!fs::exists(dir) || !fs::is_directory(dir)) return std::nullopt;

    const std::string map_id = dir.filename().string();
    if (map_id.empty()) return std::nullopt;

    // 固定 map_2d.yaml / map_2d.pgm（见 kMap2d*），忽略 last_pose.yaml 等
    std::string pgm_path;
    std::string yaml_path;
    std::string err;
    if (!resolveMap2dPaths(dir.string(), pgm_path, yaml_path, err)) {
        std::cout << "[NavManager] " << err << std::endl;
        return std::nullopt;
    }

    OfflineMapYaml meta;
    if (!parseOfflineMapYaml(yaml_path, meta, err)) {
        std::cout << "[NavManager] " << err << std::endl;
        return std::nullopt;
    }

    GrayImage img;
    if (!loadPgmFile(pgm_path, img, err)) {
        std::cout << "[NavManager] " << err << std::endl;
        return std::nullopt;
    }

    MapInfo info;
    info.id = map_id;
    info.name = map_id;
    info.source = "offline";
    info.image_path = pgm_path;
    info.image_url = "/api/v1/nav/maps/" + map_id + "/image";
    info.resolution = meta.resolution;
    info.origin_x = meta.origin_x;
    info.origin_y = meta.origin_y;
    info.width = img.width * meta.resolution;
    info.height = img.height * meta.resolution;
    info.wall_thickness = 0.2;
    return info;
}

/** 状态栏「任务」只展示导航相关动作，其余肢体动作一律映射为 IDLE */
std::string filterNavTaskAction(const std::string& action) {
    if (action == "NAVIGATION" || action == "MAP_BUILD" ||
        action == "LOCALIZATION" || action == "IDLE") {
        return action;
    }
    return "IDLE";
}

/** Lyos 导航是否处于执行中（用于 UI 锁与 active_route_id 透出） */
bool isLyosNavigationInProgress(const std::string& status) {
    return status == "PLANNING" || status == "EXECUTING";
}

/** NaviStatus 是否表示本次导航已结束（到达/失败/空闲等） */
bool isLyosNavigationTerminal(uint8_t status) {
    return status == 0 || status == 3 || status == 4 || status == 5 ||
           status == 7;
}

std::string navTaskKindName(NavTaskKind kind) {
    switch (kind) {
        case NavTaskKind::Route:
            return "route";
        case NavTaskKind::Point:
            return "point";
        default:
            return "";
    }
}

/** NaviStatus uint8 → 状态栏展示名（与 NaviStatus.msg 枚举对齐） */
std::string navigationStatusName(uint8_t status) {
    switch (status) {
        case 0:
            return "IDLE";
        case 1:
            return "PLANNING";
        case 2:
            return "EXECUTING";
        case 3:
            return "REACHED";
        case 4:
            return "FAILED";
        case 5:
            return "EMERGENCY";
        case 6:
            return "MAPPING";
        case 7:
            return "LOC_FAILED";
        default:
            return "IDLE";
    }
}
}  // namespace

NavManager::NavManager() {
    reloadOfflineMapsLocked();
    runtime_.last_update = std::chrono::steady_clock::now();
}

NavManager::~NavManager() = default;

NavManager& NavManager::getInstance() {
    static NavManager instance;
    return instance;
}

void NavManager::reloadOfflineMapsLocked() {
    namespace fs = std::filesystem;
    maps_.clear();

    const fs::path root(offlineMapsRoot());
    int loaded = 0;
    if (fs::exists(root) && fs::is_directory(root)) {
        for (const auto& entry : fs::directory_iterator(root)) {
            if (!entry.is_directory()) continue;
            auto info = parseOfflineMapDir(entry.path());
            if (!info.has_value()) continue;
            maps_[info->id] = *info;
            ++loaded;
            std::cout << "[NavManager] Offline map loaded: " << info->id
                      << std::endl;
        }
    } else {
        std::cout << "[NavManager] Offline maps root not found: "
                  << offlineMapsRoot() << std::endl;
    }

    // 已加载图若已不在目录中则清空
    if (!loaded_map_id_.empty() && !maps_.count(loaded_map_id_)) {
        loaded_map_id_.clear();
        runtime_.map_name.clear();
        clearActiveNavTaskLocked();
    }

    // 清掉地图已不存在的目标点
    for (auto wp = waypoints_.begin(); wp != waypoints_.end();) {
        if (!maps_.count(wp->second.map_id)) {
            wp = waypoints_.erase(wp);
        } else {
            ++wp;
        }
    }

    std::cout << "[NavManager] Offline maps reloaded: " << loaded << std::endl;
}

std::string NavManager::genId(const std::string& prefix) {
    std::ostringstream oss;
    oss << prefix << "-" << ++id_counter_;
    return oss.str();
}

void NavManager::touch() { runtime_.last_update = std::chrono::steady_clock::now(); }

void NavManager::clearActiveNavTaskLocked() {
    active_task_ = ActiveNavTask{};
    runtime_.active_route_id.clear();
    runtime_.current_waypoint_id.clear();
}

Json::Value NavManager::pathMsgToJson(const nav_msgs::msg::Path& path) {
    Json::Value json;
    json["frame_id"] = path.header().frame_id();
    Json::Value points(Json::arrayValue);

    const auto& poses = path.poses();
    const size_t n = poses.size();
    // 点过多时下采样，避免 WS JSON 过大
    const size_t max_points = 400;
    const size_t step = (n > max_points) ? ((n + max_points - 1) / max_points)
                                         : 1;
    for (size_t i = 0; i < n; i += step) {
        const auto& pos = poses[i].pose().position();
        Json::Value p;
        p["x"] = pos.x();
        p["y"] = pos.y();
        points.append(p);
    }
    // 保尾点，局部短轨迹更完整
    if (n > 1 && (n - 1) % step != 0) {
        const auto& pos = poses.back().pose().position();
        Json::Value p;
        p["x"] = pos.x();
        p["y"] = pos.y();
        points.append(p);
    }
    json["points"] = points;
    return json;
}

void NavManager::broadcastEmptyNavPaths() {
    Json::Value empty;
    empty["frame_id"] = "map";
    empty["points"] = Json::Value(Json::arrayValue);
    WebSocketHandler::broadcastMessage("nav_global_path", empty, "navigation");
    WebSocketHandler::broadcastMessage("nav_local_path", empty, "navigation");
}

// ---------------- 运行状态 ----------------

NavRuntimeState NavManager::getRuntimeState() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return runtime_;
}

bool NavManager::syncLoadedMapFromLyosLocked(const std::string& current_map,
                                             bool map_loaded) {
    // 建图会话独占底图；SLAM 报的 current_map 可能是正在构建名，勿抢切
    if (mapping_.active) {
        return false;
    }
    // 无有效地图名：不强制卸载，保留当前选择
    if (current_map.empty() || current_map == "NONE") {
        return false;
    }
    // 未加载完成时不强切（避免过渡名抖动）；已本地有同名图则可提前对齐
    if (!map_loaded && maps_.find(current_map) == maps_.end()) {
        return false;
    }
    if (loaded_map_id_ == current_map) {
        return false;
    }

    auto it = maps_.find(current_map);
    if (it == maps_.end()) {
        // 同名缺失只重载一次，避免 current_state 高频刷盘
        if (last_lyos_map_sync_name_ != current_map) {
            last_lyos_map_sync_name_ = current_map;
            reloadOfflineMapsLocked();
            it = maps_.find(current_map);
        }
        if (it == maps_.end()) {
            std::cout << "[NavManager] Lyos current_map not found offline: "
                      << current_map << std::endl;
            return false;
        }
    }
    last_lyos_map_sync_name_ = current_map;

    // 以机器人定位所在图为准
    loaded_map_id_ = current_map;
    runtime_.map_name = it->second.name;
    clearActiveNavTaskLocked();
    touch();
    std::cout << "[NavManager] Synced loaded map from Lyos current_map: "
              << current_map << std::endl;
    return true;
}

void NavManager::updateFromLyos(const std::string& current_action,
                                uint8_t navigation_status, double x, double y,
                                double yaw, bool localized, float loc_fitness,
                                double speed_x, double speed_y, double speed_z,
                                double distance_to_goal,
                                const std::string& current_map,
                                bool map_loaded) {
    bool left_navigation = false;
    bool left_mapping = false;
    std::string load_map_name;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        syncLoadedMapFromLyosLocked(current_map, map_loaded);

        const std::string prev_task =
            runtime_.task.empty() ? "IDLE" : runtime_.task;
        const std::string new_task = filterNavTaskAction(current_action);

        runtime_.pose.x = x;
        runtime_.pose.y = y;
        runtime_.pose.z = 0;
        runtime_.pose.roll = 0;
        runtime_.pose.pitch = 0;
        runtime_.pose.yaw = yaw;
        runtime_.task = new_task;
        runtime_.navigation_status = navigationStatusName(navigation_status);
        runtime_.localized = localized;
        runtime_.loc_fitness = loc_fitness;
        runtime_.twist.linear = std::hypot(speed_x, speed_y);
        runtime_.twist.angular = speed_z;
        runtime_.distance_to_goal = distance_to_goal;
        runtime_.connected = true;

        // UI 任务会话：过程态终态时释放锁（路径清理由离开 NAVIGATION 统一做）
        if (active_task_.running && !active_task_.paused &&
            isLyosNavigationTerminal(navigation_status)) {
            clearActiveNavTaskLocked();
        }

        // 导航任务真正结束：action 离开 NAVIGATION → 清路径
        if (prev_task == "NAVIGATION" && new_task != "NAVIGATION") {
            left_navigation = true;
        }

        applyMappingActionLocked(prev_task, new_task, current_map, left_mapping,
                                 load_map_name);
        touch();
    }

    if (left_navigation) {
        broadcastEmptyNavPaths();
    }
    if (left_mapping && !load_map_name.empty()) {
        loadMapAfterMappingAsync(load_map_name);
    }
}

void NavManager::applyMappingActionLocked(const std::string& prev_task,
                                          const std::string& new_task,
                                          const std::string& current_map,
                                          bool& left_mapping,
                                          std::string& load_map_name) {
    left_mapping = false;
    load_map_name.clear();

    const bool now_build = (new_task == "MAP_BUILD");
    const bool was_build = (prev_task == "MAP_BUILD");

    if (now_build) {
        std::string name = current_map;
        if (name.empty() || name == "NONE") {
            name = last_map_start_name_;
        }
        if (name.empty()) {
            name = "mapping";
        }
        if (!mapping_.active) {
            openMappingPreviewLocked(name);
        } else if (!current_map.empty() && current_map != "NONE" &&
                   mapping_.name != current_map) {
            mapping_.name = current_map;
            runtime_.map_name = current_map;
        }
        return;
    }

    if (was_build || mapping_.active) {
        load_map_name = mapping_.name;
        if (load_map_name.empty() || load_map_name == "mapping") {
            if (!current_map.empty() && current_map != "NONE") {
                load_map_name = current_map;
            } else {
                load_map_name = last_map_start_name_;
            }
        }
        clearMappingPreviewLocked();
        last_mapping_load_error_.clear();
        last_mapping_abort_reason_.clear();
        left_mapping = true;
    }
}

Json::Value NavManager::toJson() const {
    NavRuntimeState s;
    NavTaskKind task_kind = NavTaskKind::None;
    bool route_paused = false;
    bool nav_task_active = false;
    ActiveNavTask task_snapshot;
    Json::Value mapping_json;
    std::string loaded_id;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        s = runtime_;
        task_snapshot = active_task_;
        task_kind = active_task_.kind;
        route_paused = active_task_.running && active_task_.paused;
        mapping_json = mappingToJsonLocked();
        loaded_id = loaded_map_id_;

        const std::string nav_st =
            s.navigation_status.empty() ? "IDLE" : s.navigation_status;
        const bool in_progress = isLyosNavigationInProgress(nav_st);
        nav_task_active =
            active_task_.running && (route_paused || in_progress);

        if (mapping_.active && !mapping_.name.empty()) {
            s.map_name = mapping_.name;
        }
    }

    Json::Value json;
    json["map_name"] = s.map_name;
    json["loaded_map_id"] = loaded_id;
    json["connected"] = s.connected;
    json["route_paused"] = route_paused;
    json["mapping"] = mapping_json;
    json["active_task_kind"] = navTaskKindName(task_kind);
    json["nav_task_active"] = nav_task_active;

    // 线路任务：仅在执行中透出 route/waypoint id；快速导航不落盘关联
    std::string route_out;
    std::string waypoint_out;
    if (task_kind == NavTaskKind::Route && nav_task_active) {
        route_out = s.active_route_id;
        waypoint_out = s.current_waypoint_id;
    }
    json["active_route_id"] = route_out;
    json["current_waypoint_id"] = waypoint_out;

    if (task_kind == NavTaskKind::Point && nav_task_active) {
        Json::Value goal;
        goal["x"] = task_snapshot.point_x;
        goal["y"] = task_snapshot.point_y;
        goal["yaw"] = task_snapshot.point_yaw;
        json["point_goal"] = goal;
    }

    json["task"] = s.task.empty() ? "IDLE" : s.task;
    json["status"] =
        s.navigation_status.empty() ? "IDLE" : s.navigation_status;
    json["localized"] = s.localized;
    json["loc_fitness"] = s.loc_fitness;
    json["distance_to_goal"] = s.distance_to_goal;

    Json::Value pose;
    pose["x"] = s.pose.x;
    pose["y"] = s.pose.y;
    pose["z"] = s.pose.z;
    pose["roll"] = s.pose.roll;
    pose["pitch"] = s.pose.pitch;
    pose["yaw"] = s.pose.yaw;
    json["pose"] = pose;

    Json::Value twist;
    twist["linear"] = s.twist.linear;
    twist["angular"] = s.twist.angular;
    json["twist"] = twist;

    return json;
}

// ---------------- 地图管理 ----------------

std::vector<MapInfo> NavManager::listMaps() {
    std::lock_guard<std::mutex> lock(mutex_);
    // 每次拉列表都从磁盘整表重载 offline，避免内存缓存漂移
    reloadOfflineMapsLocked();
    std::vector<MapInfo> out;
    out.reserve(maps_.size());
    for (const auto& kv : maps_) out.push_back(kv.second);
    return out;
}

std::optional<MapInfo> NavManager::getMap(const std::string& map_id) const {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = maps_.find(map_id);
    if (it == maps_.end()) return std::nullopt;
    return it->second;
}

bool NavManager::loadMap(const std::string& map_id) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (mapping_.active) return false;
    // 只校验离线库中有该图；不提前改 loaded_map_id_（避免乐观切图被 Lyos 纠回跳闪）
    return maps_.find(map_id) != maps_.end();
}

void NavManager::unloadCurrentMap() {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        loaded_map_id_.clear();
        runtime_.map_name.clear();
        clearActiveNavTaskLocked();
        runtime_.twist = NavTwist{};
        touch();
    }
    WebSocketHandler::broadcastMessage("nav_state", toJson(), "navigation");
}

bool NavManager::deleteMap(const std::string& map_id) {
    std::string disk_dir;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        // 禁止删除当前已加载地图
        if (loaded_map_id_ == map_id) {
            return false;
        }
        auto it = maps_.find(map_id);
        if (it == maps_.end()) return false;
        if (it->second.source == "offline") {
            disk_dir =
                (std::filesystem::path(offlineMapsRoot()) / map_id).string();
        }
        maps_.erase(it);
        // 级联删该地图的目标点
        for (auto wit = waypoints_.begin(); wit != waypoints_.end();) {
            if (wit->second.map_id == map_id) {
                wit = waypoints_.erase(wit);
            } else {
                ++wit;
            }
        }
        // 删除线路中已失效的整条路线，避免留下跨地图悬空资源
        for (auto rit = routes_.begin(); rit != routes_.end();) {
            bool should_erase = false;
            for (const auto& waypoint_id : rit->second.waypoint_ids) {
                if (waypoints_.find(waypoint_id) == waypoints_.end()) {
                    should_erase = true;
                    break;
                }
            }
            if (should_erase) {
                rit = routes_.erase(rit);
            } else {
                ++rit;
            }
        }
        // 删除最后一张图时，把导航状态清到不可导航的默认值
        if (maps_.empty()) {
            runtime_.navigation_status = "IDLE";
            clearActiveNavTaskLocked();
            runtime_.pose = NavPose{};
            runtime_.twist = NavTwist{};
        }
        touch();
    }
    // 同步删除磁盘目录，避免列表对账后又出现
    if (!disk_dir.empty()) {
        std::error_code ec;
        std::filesystem::remove_all(disk_dir, ec);
        if (ec) {
            std::cout << "[NavManager] remove_all failed: " << disk_dir
                      << " err=" << ec.message() << std::endl;
        } else {
            std::cout << "[NavManager] Removed map directory: " << disk_dir
                      << std::endl;
        }
    }
    WebSocketHandler::broadcastMessage("nav_state", toJson(), "navigation");
    return true;
}

std::optional<MapInfo> NavManager::getLoadedMap() const {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = maps_.find(loaded_map_id_);
    if (it == maps_.end()) return std::nullopt;
    return it->second;
}

std::string NavManager::getLoadedMapId() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return loaded_map_id_;
}

// ---------------- 目标点 CRUD ----------------

std::vector<Waypoint> NavManager::listWaypoints(const std::string& map_id) const {
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<Waypoint> out;
    for (const auto& kv : waypoints_) {
        if (kv.second.map_id == map_id) out.push_back(kv.second);
    }
    return out;
}

std::optional<Waypoint> NavManager::addWaypoint(const std::string& map_id,
                                                const std::string& name,
                                                double x, double y, double yaw,
                                                const std::string& description) {
    Waypoint w;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (maps_.find(map_id) == maps_.end()) return std::nullopt;
        w.id = genId("wp");
        w.map_id = map_id;
        w.name = name;
        w.x = x;
        w.y = y;
        w.yaw = yaw;
        w.description = description;
        waypoints_[w.id] = w;
        touch();
    }
    return w;
}

bool NavManager::updateWaypoint(const Waypoint& w) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = waypoints_.find(w.id);
    if (it == waypoints_.end()) return false;
    it->second = w;
    touch();
    return true;
}

bool NavManager::deleteWaypoint(const std::string& waypoint_id) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (waypoints_.erase(waypoint_id) == 0) return false;
    // 从线路中移除引用
    for (auto& kv : routes_) {
        auto& ids = kv.second.waypoint_ids;
        ids.erase(std::remove(ids.begin(), ids.end(), waypoint_id), ids.end());
    }
    touch();
    return true;
}

// ---------------- 线路 CRUD ----------------

std::vector<NavRoute> NavManager::listRoutes(const std::string& map_id) const {
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<NavRoute> out;
    // 路线通过 waypoint_id 反查归属地图，保证“一张图一套资源”
    for (const auto& kv : routes_) {
        bool belongs_to_map =
            kv.second.map_id == map_id && !kv.second.waypoint_ids.empty();
        for (const auto& waypoint_id : kv.second.waypoint_ids) {
            auto wp_it = waypoints_.find(waypoint_id);
            if (wp_it == waypoints_.end() || wp_it->second.map_id != map_id) {
                belongs_to_map = false;
                break;
            }
        }
        if (belongs_to_map) out.push_back(kv.second);
    }
    return out;
}

std::optional<NavRoute> NavManager::addRoute(
    const std::string& name, const std::string& description,
    const std::vector<std::string>& waypoint_ids) {
    NavRoute r;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        // 校验所有目标点存在
        for (const auto& id : waypoint_ids) {
            if (waypoints_.find(id) == waypoints_.end()) return std::nullopt;
        }
        r.id = genId("route");
        r.map_id = waypoint_ids.empty() ? "" : waypoints_[waypoint_ids.front()].map_id;
        r.name = name;
        r.description = description;
        r.waypoint_ids = waypoint_ids;
        routes_[r.id] = r;
        touch();
    }
    return r;
}

bool NavManager::deleteRoute(const std::string& route_id) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (routes_.erase(route_id) == 0) return false;
    touch();
    return true;
}

// ---------------- 建图预览（跟 MAP_BUILD） ----------------

void NavManager::clearMappingPreviewLocked() {
    mapping_ = MappingSession{};
}

void NavManager::openMappingPreviewLocked(const std::string& name) {
    loaded_map_id_.clear();
    runtime_.map_name = name;
    clearActiveNavTaskLocked();
    runtime_.twist = NavTwist{};

    mapping_ = MappingSession{};
    mapping_.active = true;
    mapping_.name = name;
    mapping_.phase = "waiting";
    last_mapping_load_error_.clear();
    last_mapping_abort_reason_.clear();
    touch();
}

Json::Value NavManager::mappingToJsonLocked() const {
    Json::Value m;
    m["active"] = mapping_.active;
    m["name"] = mapping_.name;
    m["phase"] = mapping_.phase;
    m["revision"] = static_cast<Json::UInt64>(mapping_.revision);
    m["has_image"] = mapping_.has_bmp;
    m["resolution"] = mapping_.resolution;
    m["origin_x"] = mapping_.origin_x;
    m["origin_y"] = mapping_.origin_y;
    m["width"] = mapping_.width_m;
    m["height"] = mapping_.height_m;
    m["image_url"] =
        mapping_.active ? "/api/v1/nav/maps/mapping/image" : "";
    m["load_error"] = last_mapping_load_error_;
    m["abort_reason"] = last_mapping_abort_reason_;
    return m;
}

bool NavManager::tryLoadOfflineMapLocked(const std::string& name) {
    reloadOfflineMapsLocked();
    auto it = maps_.find(name);
    if (it == maps_.end()) return false;
    loaded_map_id_ = name;
    runtime_.map_name = it->second.name;
    clearActiveNavTaskLocked();
    last_mapping_load_error_.clear();
    return true;
}

void NavManager::noteMappingStartName(const std::string& name) {
    std::lock_guard<std::mutex> lock(mutex_);
    last_map_start_name_ = name;
}

bool NavManager::isMappingActive() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return mapping_.active;
}

std::string NavManager::getMappingMapName() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return mapping_.name;
}

bool NavManager::updateMappingFromOccupancyGrid(
    const nav_msgs::msg::OccupancyGrid& grid) {
    const auto kMinInterval = std::chrono::milliseconds(
        ViewConfigManager::getInstance()
            .getConfig()
            .maps_broadcast_interval_ms);
    bool should_broadcast = false;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!mapping_.active) return false;

        const auto now = std::chrono::steady_clock::now();
        if (mapping_.has_bmp &&
            now - mapping_.last_frame_push < kMinInterval) {
            return false;
        }

        const auto& info = grid.info();
        const uint32_t w = info.width();
        const uint32_t h = info.height();
        const auto& data = grid.data();
        if (w == 0 || h == 0 ||
            data.size() < static_cast<size_t>(w) * static_cast<size_t>(h)) {
            return false;
        }

        GrayImage img;
        img.width = static_cast<int>(w);
        img.height = static_cast<int>(h);
        img.pixels.resize(static_cast<size_t>(w) * static_cast<size_t>(h));
        // OccupancyGrid：-1 未知 / 0 空闲 / 100 占用；图像行 0 对应世界 maxY
        for (uint32_t gy = 0; gy < h; ++gy) {
            for (uint32_t gx = 0; gx < w; ++gx) {
                const int8_t cell =
                    data[static_cast<size_t>(gy) * w + gx];
                uint8_t gray = 128;
                if (cell < 0) {
                    gray = 128;
                } else if (cell == 0) {
                    gray = 254;
                } else if (cell >= 100) {
                    gray = 0;
                } else {
                    gray = static_cast<uint8_t>(254 - cell * 254 / 100);
                }
                const size_t img_idx =
                    static_cast<size_t>(h - 1 - gy) * w + gx;
                img.pixels[img_idx] = gray;
            }
        }

        std::vector<uint8_t> bmp;
        std::string err;
        if (!encodeGrayBmp(img, bmp, err)) {
            std::cout << "[NavManager] mapping bmp encode failed: " << err
                      << std::endl;
            return false;
        }

        const double res = static_cast<double>(info.resolution());
        mapping_.image = std::move(img);
        mapping_.bmp = std::move(bmp);
        mapping_.has_bmp = true;
        mapping_.resolution = res > 0 ? res : 0.05;
        mapping_.origin_x = info.origin().position().x();
        mapping_.origin_y = info.origin().position().y();
        mapping_.grid_w = static_cast<int>(w);
        mapping_.grid_h = static_cast<int>(h);
        mapping_.width_m = w * mapping_.resolution;
        mapping_.height_m = h * mapping_.resolution;
        mapping_.phase = "streaming";
        ++mapping_.revision;
        mapping_.last_frame_push = now;
        runtime_.map_name = mapping_.name;
        last_mapping_abort_reason_.clear();
        touch();
        should_broadcast = true;
    }
    if (should_broadcast) {
        WebSocketHandler::broadcastMessage("nav_state", toJson(), "navigation");
    }
    return should_broadcast;
}

void NavManager::loadMapAfterMappingAsync(const std::string& map_name) {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (mapping_load_in_progress_) return;
        mapping_load_in_progress_ = true;
    }
    std::thread([map_name]() {
        NavManager::getInstance().finishMappingLoad(map_name);
    }).detach();
}

void NavManager::finishMappingLoad(const std::string& map_name) {
    bool loaded = false;
    for (int i = 0; i < kMappingScanRetries; ++i) {
        {
            std::lock_guard<std::mutex> lock(mutex_);
            if (mapping_.active) {
                mapping_load_in_progress_ = false;
                return;
            }
            if (tryLoadOfflineMapLocked(map_name)) {
                loaded = true;
                last_mapping_load_error_.clear();
                last_mapping_abort_reason_.clear();
                touch();
            }
        }
        if (loaded) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(500));
    }
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!loaded && !mapping_.active) {
            last_mapping_load_error_ = map_name;
            last_mapping_abort_reason_ = "auto_stop";
        }
        mapping_load_in_progress_ = false;
        touch();
    }
    WebSocketHandler::broadcastMessage("nav_state", toJson(), "navigation");
    std::cout << "[NavManager] After MAP_BUILD: "
              << (loaded ? "loaded " : "not found ") << map_name << std::endl;
}

bool NavManager::getMappingBmp(std::vector<uint8_t>& out_bmp,
                               uint64_t& revision) const {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!mapping_.active || !mapping_.has_bmp) return false;
    out_bmp = mapping_.bmp;
    revision = mapping_.revision;
    return true;
}

// ---------------- 导航域门禁 / 任务启动 ----------------

bool NavManager::isNavDomainTaskBusyLocked() const {
    // 单一占用源：不区分「对方是导航还是建图」，启动类指令统一看这个
    if (mapping_.active || active_task_.running) return true;
    const std::string& t = runtime_.task;
    return t == "NAVIGATION" || t == "MAP_BUILD" || t == "LOCALIZATION";
}

bool NavManager::canStartNavDomainTaskLocked(std::string& reason) const {
    if (isNavDomainTaskBusyLocked()) {
        // 区分定位中，便于前端/测试对照状态栏「任务」
        if (runtime_.task == "LOCALIZATION") {
            reason = "定位任务进行中，无法启动建图或导航";
        } else if (runtime_.task == "MAP_BUILD" || mapping_.active) {
            reason = "建图任务进行中，无法启动新任务";
        } else if (runtime_.task == "NAVIGATION" || active_task_.running) {
            reason = "导航任务进行中，无法启动新任务";
        } else {
            reason = "已有导航域任务进行中，无法启动新任务";
        }
        return false;
    }
    // 建图与导航下发共用：运控须 RUNNING（重定位不查）
    const std::string robot_status =
        RobotStateManager::getInstance().getState().status;
    if (robot_status != "RUNNING") {
        reason = "运控未处于 RUNNING，无法启动任务（当前: " + robot_status +
                 "）";
        return false;
    }
    reason.clear();
    return true;
}

bool NavManager::canStartNavDomainTask(std::string& reason) const {
    std::lock_guard<std::mutex> lock(mutex_);
    return canStartNavDomainTaskLocked(reason);
}

bool NavManager::canStartNavigationLocked(std::string& reason) const {
    if (!canStartNavDomainTaskLocked(reason)) return false;
    // 导航专属：定位 + 地图（RUNNING 已在域门禁中）
    if (!runtime_.localized) {
        reason = "定位异常，无法下发导航任务";
        return false;
    }
    if (loaded_map_id_.empty()) {
        reason = "未加载地图，无法下发导航任务";
        return false;
    }
    reason.clear();
    return true;
}

bool NavManager::canStartNavigation(std::string& reason) const {
    std::lock_guard<std::mutex> lock(mutex_);
    return canStartNavigationLocked(reason);
}

bool NavManager::canRelocalizeLocked(bool manual, std::string& reason) const {
    // 有导航域任务时禁止；不对运控 RUNNING 敏感
    if (isNavDomainTaskBusyLocked()) {
        reason = "已有导航域任务进行中，无法下发重定位";
        return false;
    }
    if (manual && loaded_map_id_.empty()) {
        reason = "未加载地图，无法手动重定位";
        return false;
    }
    reason.clear();
    return true;
}

bool NavManager::canRelocalize(bool manual, std::string& reason) const {
    std::lock_guard<std::mutex> lock(mutex_);
    return canRelocalizeLocked(manual, reason);
}

std::string NavManager::formatPointNavParam(double x, double y, double yaw) {
    std::ostringstream oss;
    oss << std::fixed << std::setprecision(6) << x << "," << y << "," << yaw;
    return oss.str();
}

std::optional<std::string> NavManager::buildRouteNavParam(
    const std::string& route_id) const {
    std::lock_guard<std::mutex> lock(mutex_);
    auto route_it = routes_.find(route_id);
    if (route_it == routes_.end() || route_it->second.waypoint_ids.empty()) {
        return std::nullopt;
    }
    std::ostringstream oss;
    oss << std::fixed;
    bool first = true;
    for (const auto& wp_id : route_it->second.waypoint_ids) {
        auto wp_it = waypoints_.find(wp_id);
        if (wp_it == waypoints_.end()) return std::nullopt;
        if (!first) oss << ";";
        first = false;
        oss.precision(6);
        oss << wp_it->second.x << "," << wp_it->second.y << ","
            << wp_it->second.yaw;
    }
    return oss.str();
}

bool NavManager::startRouteTask(const std::string& route_id) {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        std::string reason;
        if (!canStartNavigationLocked(reason)) return false;
        auto route_it = routes_.find(route_id);
        if (route_it == routes_.end() || route_it->second.waypoint_ids.empty()) {
            return false;
        }
        if (route_it->second.map_id != loaded_map_id_) {
            return false;
        }
        active_task_ = ActiveNavTask{};
        active_task_.kind = NavTaskKind::Route;
        active_task_.running = true;
        active_task_.paused = false;
        active_task_.route_id = route_it->second.id;
        active_task_.waypoint_ids = route_it->second.waypoint_ids;
        active_task_.current_index = 0;
        runtime_.active_route_id = route_it->second.id;
        runtime_.current_waypoint_id = route_it->second.waypoint_ids.front();
        touch();
    }
    WebSocketHandler::broadcastMessage("nav_state", toJson(), "navigation");
    return true;
}

bool NavManager::startPointTask(double x, double y, double yaw) {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        std::string reason;
        if (!canStartNavigationLocked(reason)) return false;
        active_task_ = ActiveNavTask{};
        active_task_.kind = NavTaskKind::Point;
        active_task_.running = true;
        active_task_.paused = false;
        active_task_.point_x = x;
        active_task_.point_y = y;
        active_task_.point_yaw = yaw;
        runtime_.active_route_id.clear();
        runtime_.current_waypoint_id.clear();
        touch();
    }
    WebSocketHandler::broadcastMessage("nav_state", toJson(), "navigation");
    return true;
}

bool NavManager::pauseRouteTask() {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!active_task_.running) return false;
        active_task_.paused = true;
        touch();
    }
    WebSocketHandler::broadcastMessage("nav_state", toJson(), "navigation");
    return true;
}

bool NavManager::resumeRouteTask() {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!active_task_.running) return false;
        active_task_.paused = false;
        touch();
    }
    WebSocketHandler::broadcastMessage("nav_state", toJson(), "navigation");
    return true;
}

void NavManager::stopRouteTask() {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        clearActiveNavTaskLocked();
        touch();
    }
    // 路径等 Lyos current_action 离开 NAVIGATION 后再清，不在点停止时抢清
    WebSocketHandler::broadcastMessage("nav_state", toJson(), "navigation");
}

}  // namespace robot_monitor
