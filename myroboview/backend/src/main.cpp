#include "myroboview/core.hpp"
#include "myroboview/api.hpp"
#include "myroboview/ros_subscriber.hpp"
#include "myroboview/command_publisher.hpp"
#include "myroboview/websocket.hpp"
#include <ament_index_cpp/get_package_share_directory.hpp>
#include <iostream>
#include <thread>

int main(int argc, char **argv) {
  using namespace myroboview;
  try {
    const auto cfg = load_config(config_path(argc, argv));
    const auto share = ament_index_cpp::get_package_share_directory("myroboview_backend");
    rclcpp::init(0, nullptr);
    auto store = std::make_shared<StateStore>(cfg);
    auto node = std::make_shared<RosSubscriber>(cfg, store);
    auto commands = std::make_shared<CommandPublisher>(*node);
    auto hub = std::make_shared<BroadcastHub>();
    std::shared_ptr<Navigation> nav;
    if (cfg["navigation"]["enabled"].asBool()) nav = std::make_shared<Navigation>(share + "/assets/navigation.json", cfg["navigation"]["speed_mps"].asDouble(),
      [commands](const auto &category, const auto &function, const auto &param) { commands->publish(category, function, param); });
    auto &app = drogon::app();
    app.disableSigtermHandling().setThreadNum(1).setLogLevel(trantor::Logger::kWarn);
    app.setMaxConnectionNum(64).setClientMaxBodySize(64 * 1024).setClientMaxWebSocketMessageSize(1024);
    app.setDocumentRoot(share + "/web");
    app.addListener(cfg["server"]["host"].asString(), cfg["server"]["port"].asUInt());
    app.registerController(std::make_shared<TelemetrySocket>(hub, store));
    register_api(store, nav, share);
    auto previous = Clock::now(), nav_emit = previous;
    const double nav_period = 1 / cfg["navigation"]["broadcast_hz"].asDouble();
    app.getLoop()->runEvery(cfg["server"]["tick_ms"].asDouble() / 1000,
      [store, hub, nav, previous, nav_emit, nav_period]() mutable {
        auto now = Clock::now();
        if (nav) nav->tick(std::chrono::duration<double>(now - previous).count());
        previous = now;
        for (const auto &frame : store->due_frames(now)) hub->broadcast(frame);
        if (nav && std::chrono::duration<double>(now - nav_emit).count() >= nav_period) {
          nav_emit = now; Json::Value frame; frame["schema_version"] = 2; frame["type"] = "nav_state";
          frame["data"] = nav->snapshot(); hub->broadcast(frame);
        }
      });
    rclcpp::executors::SingleThreadedExecutor executor;
    executor.add_node(node);
    std::exception_ptr ros_error, web_error;
    // Queue quit on Drogon's loop: also handles shutdown just before run().
    rclcpp::on_shutdown([] { drogon::app().getLoop()->queueInLoop([] { drogon::app().quit(); }); });
    std::thread ros([&] {
      try { executor.spin(); } catch (...) { ros_error = std::current_exception(); }
      app.getLoop()->queueInLoop([] { drogon::app().quit(); });
    });
    std::cout << "MyRoboView server: http://127.0.0.1:" << cfg["server"]["port"] << " /ws; telemetry subscriber + /iot/command publisher + navigation demo" << std::endl;
    try { app.run(); } catch (...) { web_error = std::current_exception(); }
    executor.cancel(); ros.join();
    // Drogon's static handlers retain the command sink until process teardown.
    // Release ROS entities now, while the ROS context is still alive.
    commands->close();
    rclcpp::shutdown();
    if (ros_error) std::rethrow_exception(ros_error);
    if (web_error) std::rethrow_exception(web_error);
    return 0;
  } catch (const std::exception &e) {
    std::cerr << "myroboview_backend: " << e.what() << std::endl;
    if (rclcpp::ok()) rclcpp::shutdown();
    return 1;
  }
}
