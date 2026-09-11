/*
 * @Author: ethan.young Ethan.Yang2@lingyiitech.com
 * @Date: 2026-06-08
 * @Description: roboview 配置管理实现，使用 lyos::Param 解析 YAML
 */

#include "view_config.h"
#include <lyos/lyos.h>
#include <iostream>

namespace robot_monitor {

namespace {

constexpr const char* kDefaultJoyConfigPath = "/data/joy_config.yaml";
constexpr const char* kDefaultActionScriptPath =
    "/app/etc/motor_state_publisher/config";
constexpr const char* kDefaultLocalMapsPath = "/root/maps";
constexpr const char* kDefaultLocalLogsPath = "/data/bigdata/lyoslog";
constexpr const char* kDefaultLocalBagsPath = "/data/bigdata/lyosbag";

void loadTopic(lyos::Param& param, const char* key, std::string& field,
               const std::string& default_value) {
    std::string value = default_value;
    param.param(key, value, default_value);
    field = value;
}

}  // namespace

std::string ViewConfig::joyConfigPathOrDefault() const {
    return joy_config_path.empty() ? kDefaultJoyConfigPath : joy_config_path;
}

std::string ViewConfig::actionScriptPathOrDefault() const {
    return action_script_path.empty() ? kDefaultActionScriptPath
                                      : action_script_path;
}

std::string ViewConfig::localMapsPathOrDefault() const {
    return local_maps_path.empty() ? kDefaultLocalMapsPath : local_maps_path;
}

std::string ViewConfig::localLogsPathOrDefault() const {
    return local_logs_path.empty() ? kDefaultLocalLogsPath : local_logs_path;
}

std::string ViewConfig::localBagsPathOrDefault() const {
    return local_bags_path.empty() ? kDefaultLocalBagsPath : local_bags_path;
}

bool ViewConfigManager::loadFromFile(const std::string& yaml_path) {
    try {
        lyos::Param param(yaml_path);

        std::string str_default;
        param.param("product", config_.product, str_default);
        param.param("platform", config_.platform, str_default);
        param.param("robot_type", config_.robot_type, str_default);

        uint32_t default_motor_count = 0;
        param.param("motor_count", config_.motor_count, default_motor_count);

        // 话题订阅
        auto& t = config_.topics;
        loadTopic(param, "topic_state", t.state, "/system/current_state");
        loadTopic(param, "topic_motor_health", t.motor_health,
                  "/motor_control/motor_health");
        loadTopic(param, "topic_motor_feedback", t.motor_feedback,
                  "/motor_control/motor_comand_feedback");
        loadTopic(param, "topic_imu", t.imu, "/imu/data");
        loadTopic(param, "topic_sensor_status", t.sensor_status, "");
        loadTopic(param, "topic_monitor", t.monitor,
                  "/system/resource_monitor");
        loadTopic(param, "topic_joy_enabled", t.joy_enabled,
                  "/iot_joy_enabled");
        loadTopic(param, "topic_mapping_map", t.mapping_map,
                  "/map2d/mapping_map");
        loadTopic(param, "topic_laserscan", t.laserscan, "/scan");
        // 兼容旧键名
        loadTopic(param, "maps_laserscan_topic", t.laserscan, t.laserscan);
        loadTopic(param, "topic_nav_global_path", t.nav_global_path, "");
        loadTopic(param, "topic_nav_teb_path", t.nav_teb_path, "");

        // 广播限频（ms）
        uint32_t default_interval_ms = 1000;
        param.param("motor_health_interval", config_.motor_health_interval,
                    default_interval_ms);
        param.param("motor_action_feedback_interval",
                    config_.motor_action_feedback_interval,
                    static_cast<uint32_t>(200));
        param.param("imu_interval", config_.imu_interval, default_interval_ms);
        param.param("monitor_interval", config_.monitor_interval,
                    default_interval_ms);

        uint32_t default_maps_ms = 500;
        param.param("maps_broadcast_interval_ms",
                    config_.maps_broadcast_interval_ms, default_maps_ms);
        param.param("maps_laserscan_broadcast_interval_ms",
                    config_.maps_laserscan_broadcast_interval_ms,
                    default_maps_ms);
        param.param("maps_path_broadcast_interval_ms",
                    config_.maps_path_broadcast_interval_ms,
                    static_cast<uint32_t>(500));
        // 兼容旧 Hz 配置：maps_frame_rate=2 → 500ms
        uint32_t legacy_maps_hz = 0;
        param.param("maps_frame_rate", legacy_maps_hz, legacy_maps_hz);
        if (legacy_maps_hz > 0) {
            config_.maps_broadcast_interval_ms = 1000 / legacy_maps_hz;
        }
        uint32_t legacy_scan_hz = 0;
        param.param("maps_laserscan_frame_rate", legacy_scan_hz, legacy_scan_hz);
        if (legacy_scan_hz > 0) {
            config_.maps_laserscan_broadcast_interval_ms = 1000 / legacy_scan_hz;
        }

        // 路径配置
        param.param("joy_config_path", config_.joy_config_path, str_default);
        param.param("action_script_path", config_.action_script_path,
                    str_default);
        param.param("local_maps_path", config_.local_maps_path, str_default);
        param.param("local_logs_path", config_.local_logs_path, str_default);
        param.param("local_bags_path", config_.local_bags_path, str_default);

        std::cout << "[ViewConfig] Loaded from: " << yaml_path << std::endl;
        std::cout << "  product=" << config_.product
                  << " platform=" << config_.platform
                  << " robot_type=" << config_.robot_type
                  << " motor_count=" << config_.motor_count << std::endl;
        std::cout << "  topics: state=" << t.state
                  << " motor_health=" << t.motor_health
                  << " motor_feedback=" << t.motor_feedback << std::endl;
        std::cout << "          imu=" << t.imu
                  << " monitor=" << t.monitor
                  << " joy_enabled=" << t.joy_enabled
                  << " mapping_map=" << t.mapping_map << std::endl;
        std::cout << "          sensor_status="
                  << (t.sensor_status.empty() ? "(disabled)" : t.sensor_status)
                  << " laserscan="
                  << (t.laserscan.empty() ? "(disabled)" : t.laserscan)
                  << std::endl;
        std::cout << "          nav_global_path="
                  << (t.nav_global_path.empty() ? "(disabled)"
                                                : t.nav_global_path)
                  << " nav_teb_path="
                  << (t.nav_teb_path.empty() ? "(disabled)" : t.nav_teb_path)
                  << std::endl;
        std::cout << "  broadcast_interval_ms: motor_health="
                  << config_.motor_health_interval
                  << " motor_feedback="
                  << config_.motor_action_feedback_interval
                  << " imu=" << config_.imu_interval
                  << " monitor=" << config_.monitor_interval
                  << " maps=" << config_.maps_broadcast_interval_ms
                  << " laserscan=" << config_.maps_laserscan_broadcast_interval_ms
                  << " nav_path=" << config_.maps_path_broadcast_interval_ms
                  << std::endl;
        std::cout << "  joy_config_path=" << config_.joyConfigPathOrDefault()
                  << " action_script_path="
                  << config_.actionScriptPathOrDefault()
                  << " local_maps_path=" << config_.localMapsPathOrDefault()
                  << std::endl;
        std::cout << "  local_logs_path=" << config_.localLogsPathOrDefault()
                  << " local_bags_path=" << config_.localBagsPathOrDefault()
                  << std::endl;
        return true;
    } catch (const std::exception& e) {
        std::cerr << "[ViewConfig] Failed to load " << yaml_path << ": "
                  << e.what() << ", using defaults" << std::endl;
        return false;
    }
}

}  // namespace robot_monitor
