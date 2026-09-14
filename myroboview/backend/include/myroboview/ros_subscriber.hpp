#pragma once
#include "myroboview/core.hpp"
#include <rclcpp/rclcpp.hpp>
namespace myroboview {
class RosSubscriber : public rclcpp::Node {
 public:
  RosSubscriber(const Json::Value &config, std::shared_ptr<StateStore> store);
 private:
  std::vector<rclcpp::GenericSubscription::SharedPtr> subscriptions_;
};
}
