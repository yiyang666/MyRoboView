#include "roboview/core.hpp"
#include "roboview/introspection.hpp"
#include "roboview/navigation.hpp"
#include <node_app_msgs/msg/robot_state.hpp>
#include <node_app_msgs/msg/motor_health_array.hpp>
#include <sensor_msgs/msg/imu.hpp>
#include <limits>
#include <iostream>

void check(bool passed, const char *message) {
    if (!passed) throw std::runtime_error(message);
}
template <class T>
Json::Value decode(const std::string &type, const T &message) {
    rclcpp::SerializedMessage wire;
    rclcpp::Serialization<T> serializer;
    serializer.serialize_message(&message, &wire);
    return roboview::Decoder(type).decode(wire);
}
int main(int argc, char **argv) {
    try {
        check(argc == 3, "config and fixture required");
        auto cfg = roboview::load_config(argv[1]);
        for (int fault = 0; fault < 8; ++fault) {
            auto bad = cfg;
            if (fault == 0) bad["topics"][1]["id"] = bad["topics"][0]["id"];
            if (fault == 1) bad["topics"][0]["qos"]["depth"] = 0;
            if (fault == 2) bad["topics"][0]["broadcast_hz"] = 0;
            if (fault == 3) bad["topics"][0]["broadcast_hz"] = 100;
            if (fault == 4) bad["topics"][0]["event"] = "nav_state";
            if (fault == 5) bad["topics"][0]["stale_sec"] = -1;
            if (fault == 6) bad["server"]["host"] = "0.0.0.0";
            if (fault == 7) bad["topics"][0]["topic"] = "/bad//topic";
            bool rejected = false;
            try {
                roboview::validate_config(bad);
            } catch (...) {
                rejected = true;
            }
            check(rejected, "invalid config accepted");
        }
        roboview::StateStore store(cfg);
        auto start = roboview::Clock::now();
        check(store.snapshot(start)["topics"][0]["state"] == "waiting",
              "initial state");
        store.update("robot_state", Json::Value(1), start);
        auto frames = store.due_frames(start);
        check(frames.size() == 3, "initial broadcast");
        check(store.due_frames(start + std::chrono::milliseconds(50)).empty(),
              "rate cap");
        frames = store.due_frames(start + std::chrono::milliseconds(100));
        check(frames.size() == 1 && frames[0]["type"] == "sensor_data",
              "independent topic limits");
        store.update("robot_state", Json::Value(2),
                     start + std::chrono::milliseconds(200));
        check(store.snapshot(start + std::chrono::seconds(1))["topics"][0]["hz"]
                      .asDouble() == 5,
              "ROS receive Hz");
        auto stale = store.snapshot(start + std::chrono::seconds(3));
        check(stale["topics"][0]["state"] == "stale" &&
                  stale["topics"][1]["state"] == "waiting",
              "independent freshness");
        store.reject("imu", "invalid");
        check(store.snapshot()["topics"][1]["state"] == "error",
              "decode error");
        store.update("imu", Json::Value(3));
        check(store.snapshot()["topics"][1]["state"] == "live", "recovery");
        node_app_msgs::msg::RobotState state;
        state.current_action = "WALK";
        state.battery_percentage = 76.;
        auto s = decode("node_app_msgs/msg/RobotState", state);
        check(s["current_action"] == "WALK" && s["battery_percentage"] == 76.,
              "robot contract");
        node_app_msgs::msg::MotorHealthArray motors;
        node_app_msgs::msg::MotorHealth m;
        m.online = true;
        m.direction = -1;
        m.position_zero_rad = 0.5;
        motors.motors.push_back(m);
        auto a = decode("node_app_msgs/msg/MotorHealthArray", motors);
        check(a["motors"][0]["online"].asBool() &&
                  a["motors"][0]["direction"].asInt() == -1 &&
                  a["motors"][0]["position_zero_rad"] == 0.5,
              "motor array");
        sensor_msgs::msg::Imu imu;
        imu.angular_velocity.z = std::numeric_limits<double>::quiet_NaN();
        auto i = decode("sensor_msgs/msg/Imu", imu);
        check(i["angular_velocity"]["z"].isNull() &&
                  i["orientation_covariance"].size() == 9,
              "standard ROS conversion");
        roboview::Navigation nav(argv[2], 1.);
        Json::Value body;
        body["route_id"] = "route-demo-testMap01";
        nav.start(body);
        auto before = nav.snapshot()["pose"];
        nav.tick(.25);
        check(nav.snapshot()["pose"] != before, "demo movement");
        nav.pause();
        before = nav.snapshot()["pose"];
        nav.tick(.25);
        check(nav.snapshot()["pose"] == before &&
                  nav.snapshot()["twist"]["linear"] == 0.,
              "paused position");
        nav.resume();
        for (int tick = 0; tick < 1000; ++tick) nav.tick(.25);
        check(nav.snapshot()["status"] == "SUCCEEDED", "route completion");
        check(std::abs(nav.snapshot()["pose"]["x"].asDouble() - 37.389) < 1e-9,
              "final waypoint");
        bool rejected = false;
        try {
            nav.delete_waypoint("wp-start");
        } catch (const roboview::NavError &e) {
            rejected = e.code == 409;
        }
        check(rejected, "referenced point protected");
        roboview::Navigation failing_nav(
            argv[2], 1., [](const auto &, const auto &, const auto &) {
                throw std::runtime_error("publisher failed");
            });
        rejected = false;
        try {
            failing_nav.start(body);
        } catch (const std::runtime_error &) {
            rejected = true;
        }
        check(rejected && failing_nav.snapshot()["status"] == "IDLE",
              "failed publish must not start simulation");
        std::cout << "PASS configuration, ROS types, broadcast limits, "
                     "freshness and navigation states\n";
        return 0;
    } catch (const std::exception &e) {
        std::cerr << e.what() << '\n';
        return 1;
    }
}
