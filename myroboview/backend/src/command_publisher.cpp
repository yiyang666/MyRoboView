#include "myroboview/command_publisher.hpp"
namespace myroboview {
CommandPublisher::CommandPublisher(rclcpp::Node &node) {
  publisher_ = node.create_publisher<node_app_msgs::msg::IotCmdMsg>("/iot/command", rclcpp::QoS(10).reliable().durability_volatile());
}
void CommandPublisher::publish(const std::string &category, const std::string &function, const std::string &param) {
  node_app_msgs::msg::IotCmdMsg message;
  message.category = category; message.fun_name = function; message.sub = ""; message.param = param;
  publisher_->publish(message);
}
}
