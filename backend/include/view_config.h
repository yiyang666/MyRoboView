/*
 * @Author: ethan.young Ethan.Yang2@lingyiitech.com
 * @Date: 2026-06-08
 * @Description: roboview 配置管理，负责从 YAML 配置文件加载视图渲染相关参数
 */

#pragma once

#include <cstdint>
#include <string>

namespace robot_monitor {

/// Lyos 话题订阅（空字符串表示不订阅，仅对可选话题生效）
struct LyosTopics {
    std::string state = "/system/current_state";
    std::string motor_health = "/motor_control/motor_health";
    std::string motor_feedback = "/motor_control/motor_comand_feedback";
    std::string imu = "/imu/data";
    std::string sensor_status;  // 可选，默认不订阅
    std::string monitor = "/system/resource_monitor";
    std::string joy_enabled = "/iot_joy_enabled";
    std::string mapping_map = "/map2d/mapping_map";
    std::string laserscan = "/scan";  // 预留；置空则不订阅
    std::string nav_global_path;      // 全局规划路径；置空则不订阅
    std::string nav_teb_path;         // 当前段 TEB 局部轨迹；置空则不订阅
};

/// roboview 运行时配置，来源于 roboview.yaml
struct ViewConfig {
    // === 产品信息 ===
    std::string product{};
    std::string platform{};
    std::string robot_type{};

    // === 机器人信息 ===
    uint32_t motor_count{};

    // === 话题订阅 ===
    LyosTopics topics;

    // === 广播限频（最小间隔，单位 ms）===
    uint32_t motor_health_interval = 1000;
    uint32_t motor_action_feedback_interval = 200;
    uint32_t imu_interval = 1000;
    uint32_t monitor_interval = 1000;
    uint32_t maps_broadcast_interval_ms = 500;          ///< 建图 OccupancyGrid
    uint32_t maps_laserscan_broadcast_interval_ms = 500;  ///< 预留 LaserScan
    uint32_t maps_path_broadcast_interval_ms = 500;     ///< 导航 global/local Path

    // === 路径配置（空则使用默认值）===
    std::string joy_config_path;
    std::string action_script_path;
    std::string local_maps_path;
    std::string local_logs_path;
    std::string local_bags_path;

    std::string joyConfigPathOrDefault() const;
    std::string actionScriptPathOrDefault() const;
    std::string localMapsPathOrDefault() const;
    std::string localLogsPathOrDefault() const;
    std::string localBagsPathOrDefault() const;
};

/// 线程安全的配置管理器（单例）
class ViewConfigManager {
 public:
    static ViewConfigManager& getInstance() {
        static ViewConfigManager instance;
        return instance;
    }

    bool loadFromFile(const std::string& yaml_path);
    const ViewConfig& getConfig() const { return config_; }

    ViewConfigManager(const ViewConfigManager&) = delete;
    ViewConfigManager& operator=(const ViewConfigManager&) = delete;

 private:
    ViewConfigManager() = default;
    ~ViewConfigManager() = default;

    ViewConfig config_;
};

}  // namespace robot_monitor
