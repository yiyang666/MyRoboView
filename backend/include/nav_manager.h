#pragma once

#include <atomic>
#include <chrono>
#include <cstdint>
#include <map>
#include <mutex>
#include <optional>
#include <string>
#include <vector>
#include <json/json.h>

#include "nav_map_io.h"

namespace nav_msgs {
namespace msg {
class OccupancyGrid;
class Path;
}
}  // namespace nav_msgs

namespace robot_monitor {

struct NavPose {
    double x = 0;
    double y = 0;
    double z = 0;
    double roll = 0;
    double pitch = 0;
    double yaw = 0;
};

struct NavTwist {
    double linear = 0;
    double angular = 0;
};

/** 导航任务类型：线路（持久化目标点/线路） vs 快速单点（不落盘，调试用） */
enum class NavTaskKind { None, Route, Point };

// 运行状态：WS 推送给前端
struct NavRuntimeState {
    std::string map_name;                // 当前已加载地图名；空 = 未加载
    std::string active_route_id;         // 线路任务：当前线路 id
    std::string current_waypoint_id;     // 线路任务：当前目标点 id
    NavPose pose;
    NavTwist twist;
    // 来自 LrsState
    std::string task = "IDLE";  // current_action 过滤后：NAVIGATION/MAP_BUILD/…
    std::string navigation_status = "IDLE";  // NaviStatus：PLANNING/EXECUTING/…
    bool localized = false;
    float loc_fitness = 0.f;             // 定位重叠率 0~1
    double distance_to_goal = 0.0;
    bool connected = false;
    std::chrono::steady_clock::time_point last_update;
};

struct MapInfo {
    std::string id;
    std::string name;
    std::string image_url;               // 前端加载的底图 URL（静态或 API）
    std::string image_path;              // 离线 PGM 绝对路径（可选）
    std::string source = "offline";      // offline | online
    double resolution = 0.05;            // 米/像素
    double origin_x = 0;                 // 地图左下角世界坐标 x
    double origin_y = 0;                 // 地图左下角世界坐标 y
    double width = 0;
    double height = 0;
    double wall_thickness = 0.2;
};

struct Waypoint {
    std::string id;
    std::string map_id;
    std::string name;
    double x = 0;
    double y = 0;
    double yaw = 0;
    std::string description;
};

struct NavRoute {
    std::string id;
    std::string map_id;
    std::string name;
    std::string description;
    std::vector<std::string> waypoint_ids;  // 有序
};

/** 当前导航任务会话（内存态；线路任务关联 route/waypoint，快速导航仅存坐标） */
struct ActiveNavTask {
    NavTaskKind kind = NavTaskKind::None;
    bool running = false;
    bool paused = false;
    // 线路任务
    std::string route_id;
    std::vector<std::string> waypoint_ids;
    size_t current_index = 0;
    // 快速导航：单点目标，不落盘
    double point_x = 0;
    double point_y = 0;
    double point_yaw = 0;
};

/** 建图预览缓存：仅在 MAP_BUILD 期间持有 OccupancyGrid 转 BMP，不单独养状态机 */
struct MappingSession {
    bool active = false;  // 与车上 MAP_BUILD 对齐
    std::string name;
    // waiting：尚无栅格；streaming：已有 OccupancyGrid
    std::string phase = "idle";  // idle | waiting | streaming
    uint64_t revision = 0;
    double resolution = 0.05;
    double origin_x = 0;
    double origin_y = 0;
    double width_m = 0;
    double height_m = 0;
    int grid_w = 0;
    int grid_h = 0;
    GrayImage image;
    std::vector<uint8_t> bmp;
    bool has_bmp = false;
    std::chrono::steady_clock::time_point last_frame_push{};
};

/**
 * 导航域集中管理：状态、地图库、目标点、线路、任务会话
 */
class NavManager {
 public:
    static NavManager& getInstance();

    // 运行状态（WS 用）
    NavRuntimeState getRuntimeState() const;
    /**
     * 从 LrsState 一次更新：任务态(current_action) + 过程态(navigation_status)
     * + 位姿/地图对齐；内部处理 MAP_BUILD 边沿与离开 NAVIGATION 时清路径
     */
    void updateFromLyos(const std::string& current_action,
                        uint8_t navigation_status, double x, double y,
                        double yaw, bool localized, float loc_fitness,
                        double speed_x, double speed_y, double speed_z,
                        double distance_to_goal, const std::string& current_map,
                        bool map_loaded);
    Json::Value toJson() const;   // 拼成 nav_state 广播用的 data

    // 地图管理
    std::vector<MapInfo> listMaps();  // 每次刷新都从磁盘重载 offline 目录
    std::optional<MapInfo> getMap(const std::string& map_id) const;
    // 请求切图：仅校验地图存在；真正 loaded 以 Lyos current_map 同步为准
    bool loadMap(const std::string& map_id);
    bool deleteMap(const std::string& map_id);
    std::optional<MapInfo> getLoadedMap() const;
    std::string getLoadedMapId() const;
    // 建图中：清空当前加载（不删库内地图）
    void unloadCurrentMap();

    // 目标点 CRUD（内存；后续由 map server 落盘）
    std::vector<Waypoint> listWaypoints(const std::string& map_id) const;
    std::optional<Waypoint> addWaypoint(const std::string& map_id,
                                        const std::string& name, double x,
                                        double y, double yaw,
                                        const std::string& description);
    bool updateWaypoint(const Waypoint& w);
    bool deleteWaypoint(const std::string& waypoint_id);

    // 线路 CRUD（内存；后续由 map server 落盘）
    std::vector<NavRoute> listRoutes(const std::string& map_id) const;
    std::optional<NavRoute> addRoute(const std::string& name,
                                     const std::string& description,
                                     const std::vector<std::string>& waypoint_ids);
    bool deleteRoute(const std::string& route_id);

    // 把线路目标点拼成 NAV START 的 param："x,y,yaw;x,y,yaw;..."
    std::optional<std::string> buildRouteNavParam(const std::string& route_id) const;
    // 快速导航单点 param："x,y,yaw"
    static std::string formatPointNavParam(double x, double y, double yaw);

    // -------- 建图预览（模式由状态机 MAP_BUILD 决定） --------
    void noteMappingStartName(const std::string& name);
    bool isMappingActive() const;
    std::string getMappingMapName() const;
    // 写入 OccupancyGrid（限频）；仅 MAP_BUILD 预览开启时生效
    bool updateMappingFromOccupancyGrid(
        const nav_msgs::msg::OccupancyGrid& grid);
    // 取建图内存 BMP（供 /maps/mapping/image）
    bool getMappingBmp(std::vector<uint8_t>& out_bmp, uint64_t& revision) const;

    // -------- 导航域门禁（线路/快速导航/建图启动共用占用判断） --------
    /**
     * 启动建图 / 导航域任务共用：域空闲 + 运控 RUNNING。
     * 重定位不走此门禁。
     */
    bool canStartNavDomainTask(std::string& reason) const;
    /**
     * 启动线路/快速导航：canStartNavDomainTask + 定位正常 + 已加载地图。
     * API 在 publish START 前调用；start*Task 内再校验防竞态。
     */
    bool canStartNavigation(std::string& reason) const;
    /**
     * 重定位门禁（手动/自动）：导航域有任务时不允许；
     * 不检查运控 current_state（RUNNING）。手动另需已加载地图。
     */
    bool canRelocalize(bool manual, std::string& reason) const;

    bool startRouteTask(const std::string& route_id);
    bool startPointTask(double x, double y, double yaw);
    bool pauseRouteTask();
    bool resumeRouteTask();
    void stopRouteTask();

    /** Path → WS JSON（无缓存，回调直推） */
    static Json::Value pathMsgToJson(const nav_msgs::msg::Path& path);
    /** 导航任务真正结束时推空 path，清前端渲染 */
    void broadcastEmptyNavPaths();

 private:
    NavManager();
    ~NavManager();
    NavManager(const NavManager&) = delete;
    NavManager& operator=(const NavManager&) = delete;

    void touch();
    void reloadOfflineMapsLocked();
    std::string genId(const std::string& prefix);
    void clearMappingPreviewLocked();
    void openMappingPreviewLocked(const std::string& name);
    Json::Value mappingToJsonLocked() const;
    bool tryLoadOfflineMapLocked(const std::string& name);
    bool syncLoadedMapFromLyosLocked(const std::string& current_map,
                                     bool map_loaded);
    // 离开 MAP_BUILD 后异步扫盘加载
    void loadMapAfterMappingAsync(const std::string& map_name);
    void finishMappingLoad(const std::string& map_name);
    void clearActiveNavTaskLocked();
    /** 导航域占用：Lyos 任务态 / 建图预览 / 本端会话 */
    bool isNavDomainTaskBusyLocked() const;
    bool canStartNavDomainTaskLocked(std::string& reason) const;
    bool canStartNavigationLocked(std::string& reason) const;
    bool canRelocalizeLocked(bool manual, std::string& reason) const;
    /** 处理 MAP_BUILD 进入/离开；返回是否刚离开建图及待加载地图名 */
    void applyMappingActionLocked(const std::string& prev_task,
                                  const std::string& new_task,
                                  const std::string& current_map,
                                  bool& left_mapping,
                                  std::string& load_map_name);

    mutable std::mutex mutex_;
    std::string last_mapping_load_error_;
    std::string last_mapping_abort_reason_;
    std::string last_lyos_map_sync_name_;
    std::string last_map_start_name_;
    bool mapping_load_in_progress_ = false;
    NavRuntimeState runtime_;
    std::map<std::string, MapInfo> maps_;
    std::map<std::string, Waypoint> waypoints_;
    std::map<std::string, NavRoute> routes_;
    std::string loaded_map_id_;
    MappingSession mapping_;
    ActiveNavTask active_task_;
    std::atomic<uint64_t> id_counter_{0};
};

}  // namespace robot_monitor
