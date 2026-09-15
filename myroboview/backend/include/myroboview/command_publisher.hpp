#pragma once
#include <rclcpp/rclcpp.hpp>
#include <node_app_msgs/msg/iot_cmd_msg.hpp>
namespace myroboview {
class CommandPublisher {
 public:
    explicit CommandPublisher(rclcpp::Node &node);
    void close() { publisher_.reset(); }
    void publish(const std::string &category, const std::string &function,
                 const std::string &param);

 private:
    rclcpp::Publisher<node_app_msgs::msg::IotCmdMsg>::SharedPtr publisher_;
};
}  // namespace myroboview
