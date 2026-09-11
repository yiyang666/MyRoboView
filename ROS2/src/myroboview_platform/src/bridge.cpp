#include "myroboview/core.hpp"
#include "myroboview/http.hpp"
#include "myroboview/introspection.hpp"
#include <ament_index_cpp/get_package_share_directory.hpp>
#include <iostream>
#include <thread>

namespace myroboview {
class Monitor : public rclcpp::Node {
 public:
  Monitor(const Json::Value &cfg, std::shared_ptr<StateStore> store) : Node("myroboview_bridge") {
    for (const auto &spec : cfg["topics"]) {
      const auto id = spec["id"].asString();
      auto decoder = std::make_shared<Decoder>(spec["type"].asString());
      subscriptions_.push_back(create_generic_subscription(spec["topic"].asString(), spec["type"].asString(), qos(spec),
        [decoder, store, id](std::shared_ptr<rclcpp::SerializedMessage> message) {
          try { store->update(id, decoder->decode(*message)); }
          catch (const std::exception &e) { store->reject(id, e.what()); }
        }));
    }
  }
 private:
  std::vector<rclcpp::GenericSubscription::SharedPtr> subscriptions_;
};
}
int main(int argc, char **argv) {
  try {
    const auto opts = myroboview::options(argc, argv);
    const auto cfg = myroboview::load_config(opts.config);
    rclcpp::init(0, nullptr);
    auto store = std::make_shared<myroboview::StateStore>(cfg);
    auto node = std::make_shared<myroboview::Monitor>(cfg, store);
    boost::asio::io_context io;
    myroboview::HttpServer server(io, cfg, store, ament_index_cpp::get_package_share_directory("myroboview_platform") + "/web");
    rclcpp::executors::SingleThreadedExecutor executor;
    executor.add_node(node);
    std::exception_ptr ros_error, http_error;
    std::thread ros([&] {
      try { executor.spin(); } catch (...) { ros_error = std::current_exception(); }
      io.stop();
    });
    std::cout << "MyRoboView C++: http://127.0.0.1:" << cfg["server"]["port"].asUInt() << " (ROS2, read-only)" << std::endl;
    try { io.run(); } catch (...) { http_error = std::current_exception(); }
    executor.cancel(); ros.join();
    rclcpp::shutdown();
    if (ros_error) std::rethrow_exception(ros_error);
    if (http_error) std::rethrow_exception(http_error);
    return 0;
  } catch (const std::exception &e) {
    std::cerr << "bridge: " << e.what() << std::endl;
    if (rclcpp::ok()) rclcpp::shutdown();
    return 1;
  }
}
