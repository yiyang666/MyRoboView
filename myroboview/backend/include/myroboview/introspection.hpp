#pragma once
#include <json/json.h>
#include <rclcpp/serialization.hpp>
#include <rclcpp/typesupport_helpers.hpp>
#include <rosidl_typesupport_introspection_cpp/message_introspection.hpp>

namespace myroboview {
// Libraries outlive their metadata and each temporary deserialized message.
class Decoder {
 public:
  explicit Decoder(const std::string &type);
  Json::Value decode(const rclcpp::SerializedMessage &message) const;
 private:
  std::shared_ptr<rcpputils::SharedLibrary> cpp_library_, introspection_library_;
  const rosidl_typesupport_introspection_cpp::MessageMembers *members_;
  std::unique_ptr<rclcpp::SerializationBase> serializer_;
};
}  // namespace myroboview
