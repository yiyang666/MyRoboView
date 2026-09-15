#include "robotapp/state_machine.hpp"
#include <node_app_msgs/msg/motor_health.hpp>
#include <node_app_msgs/msg/motor_health_state.hpp>
#include <sensor_msgs/msg/imu.hpp>
#include <rclcpp/rclcpp.hpp>
#include <ament_index_cpp/get_package_prefix.hpp>
#include <json/json.h>
#include <fstream>
#include <iostream>
#include <set>

namespace {
void numeric(const Json::Value &v, double lo, double hi) {
    if (!v.isNumeric() || !std::isfinite(v.asDouble()) || v.asDouble() < lo ||
        v.asDouble() > hi)
        throw std::invalid_argument("Invalid robotapp numeric configuration");
}
// 机器人类型字符串 → RobotState.robot_type 枚举（与 myroboview.json 的 robot.type 取值一致）
uint8_t robot_type_of(const Json::Value &v) {
    using State = node_app_msgs::msg::RobotState;
    if (!v.isString())
        throw std::invalid_argument("robot.type must be string");
    if (v.asString() == "humanoid") return State::TYPE_HUMANOID;
    if (v.asString() == "quadruped_wheeled") return State::TYPE_QUADRUPED_WHEELED;
    throw std::invalid_argument("Unknown robot.type: " + v.asString());
}
void text(const Json::Value &v, const char *what) {
    if (!v.isString() || v.asString().empty() || v.asString().size() > 64)
        throw std::invalid_argument(std::string("Invalid ") + what);
}
Json::Value config(const std::string &path) {
    std::ifstream f(path);
    Json::Value cfg;
    Json::CharReaderBuilder reader;
    std::string error;
    reader["rejectDupKeys"] = true;
    reader["failIfExtra"] = true;
    if (!f || !Json::parseFromStream(reader, f, &cfg, &error))
        throw std::invalid_argument("Cannot parse robotapp config: " + error);
    // robot 段按产品拆分（type/product/id），与 roboview 配置约定对齐
    text(cfg["robot"]["type"], "robot.type");
    robot_type_of(cfg["robot"]["type"]);
    text(cfg["robot"]["product"], "robot.product");
    text(cfg["robot"]["id"], "robot.id");
    // scenario 缺省 nominal；fault 用于注入故障演示
    const std::string scenario = cfg.get("scenario", "nominal").asString();
    if (scenario != "nominal" && scenario != "fault")
        throw std::invalid_argument("Unknown scenario");
    numeric(cfg["state_step_sec"], 0.1, 60);
    numeric(cfg["motor_count"], 1, 64);
    if (!cfg["motor_count"].isUInt())
        throw std::invalid_argument("motor_count must be integer");
    std::set<std::string> names;
    for (const auto *key : {"robot_state", "imu", "motor_health"}) {
        const auto &topic = cfg["topics"][key];
        numeric(topic["hz"], 0.1, 500);
        if (!topic["name"].isString() || topic["name"].asString().empty() ||
            topic["name"].asString()[0] != '/' ||
            !names.insert(topic["name"].asString()).second)
            throw std::invalid_argument("Expected unique absolute topic names");
    }
    return cfg;
}
class RobotApp : public rclcpp::Node {
 public:
    explicit RobotApp(Json::Value cfg)
        : Node("robotapp"), cfg_(std::move(cfg)),
          robot_type_(robot_type_of(cfg_["robot"]["type"])) {
        state_ = create_publisher<node_app_msgs::msg::RobotState>(
            name("robot_state"), rclcpp::QoS(10).reliable());
        imu_ = create_publisher<sensor_msgs::msg::Imu>(name("imu"),
                                                       rclcpp::SensorDataQoS());
        motors_ = create_publisher<node_app_msgs::msg::MotorHealth>(
            name("motor_health"), rclcpp::QoS(10).reliable());
        timers_.push_back(create_wall_timer(period("robot_state"), [this] {
            auto msg = robotapp::state_at(elapsed(),
                                          cfg_["state_step_sec"].asDouble(),
                                          fault(), robot_type_);
            msg.header.stamp = now();
            msg.header.frame_id = "base_link";
            // 身份信息随每帧携带，监控端可据此区分产品/个体
            msg.robot_type = robot_type_;
            msg.product = cfg_["robot"]["product"].asString();
            msg.robot_id = cfg_["robot"]["id"].asString();
            state_->publish(msg);
        }));
        timers_.push_back(create_wall_timer(period("imu"), [this] {
            sensor_msgs::msg::Imu msg;
            const double t = elapsed();
            msg.header.stamp = now();
            msg.header.frame_id = "imu_link";
            msg.orientation.z = std::sin(t * 0.1);
            msg.orientation.w = std::cos(t * 0.1);
            msg.angular_velocity.z = 0.2;
            msg.linear_acceleration.z = 9.81;
            imu_->publish(msg);
        }));
        timers_.push_back(create_wall_timer(period("motor_health"), [this] {
            node_app_msgs::msg::MotorHealth msg;
            msg.header.stamp = now();
            msg.header.frame_id = "base_link";
            const unsigned count = cfg_["motor_count"].asUInt();
            msg.motor_count = count;
            for (unsigned i = 0; i < count; ++i) {
                node_app_msgs::msg::MotorHealthState m;
                m.motor_id = i;
                // 故障注入：0 号电机离线+故障+高温，1 号警告，演示卡片分级的颜色差异
                m.online_status = fault() && i == 0
                                      ? decltype(m)::STATUS_OFFLINE
                                      : decltype(m)::STATUS_ONLINE;
                m.health_status =
                    fault() && i == 0    ? decltype(m)::HEALTH_ERROR
                    : fault() && i == 1  ? decltype(m)::HEALTH_WARNING
                                         : decltype(m)::HEALTH_OK;
                m.motor_direction = i % 2 ? decltype(m)::REVERSE
                                          : decltype(m)::FORWARD;
                m.motor_temperature =
                    fault() && i == 0   ? 85
                    : fault() && i == 1 ? 75
                                        : 32 + i + 2 * std::sin(elapsed() / 5);
                m.motor_voltage = 48.0;
                m.motor_position_zero_rad = 0.01 * i;
                msg.motors.push_back(m);
            }
            motors_->publish(msg);
        }));
    }

 private:
    std::string name(const char *key) {
        return cfg_["topics"][key]["name"].asString();
    }
    std::chrono::duration<double> period(const char *key) {
        return std::chrono::duration<double>(
            1 / cfg_["topics"][key]["hz"].asDouble());
    }
    double elapsed() {
        return std::chrono::duration<double>(std::chrono::steady_clock::now() -
                                             start_)
            .count();
    }
    bool fault() {
        return cfg_.get("scenario", "nominal").asString() == "fault";
    }
    Json::Value cfg_;
    uint8_t robot_type_;
    std::chrono::steady_clock::time_point start_ =
        std::chrono::steady_clock::now();
    rclcpp::Publisher<node_app_msgs::msg::RobotState>::SharedPtr state_;
    rclcpp::Publisher<sensor_msgs::msg::Imu>::SharedPtr imu_;
    rclcpp::Publisher<node_app_msgs::msg::MotorHealth>::SharedPtr motors_;
    std::vector<rclcpp::TimerBase::SharedPtr> timers_;
};
}  // namespace

int main(int argc, char **argv) {
    try {
        // 默认配置在安装前缀 etc/robotapp/ 下（按产品安装对应那份），--config 可覆盖
        std::string path = ament_index_cpp::get_package_prefix("robotapp") +
                           "/etc/robotapp/robotapp.json";
        if (argc == 3 && std::string(argv[1]) == "--config")
            path = argv[2];
        else if (argc != 1)
            throw std::invalid_argument("Usage: robotapp_node [--config PATH]");
        auto cfg = config(path);
        rclcpp::init(0, nullptr);
        auto node = std::make_shared<RobotApp>(cfg);
        std::cout << "robotapp: publishing RobotState, Imu, MotorHealth ("
                  << cfg["robot"]["product"].asString() << " mock)"
                  << std::endl;
        rclcpp::spin(node);
        rclcpp::shutdown();
        return 0;
    } catch (const std::exception &e) {
        std::cerr << "robotapp: " << e.what() << std::endl;
        if (rclcpp::ok()) rclcpp::shutdown();
        return 1;
    }
}
