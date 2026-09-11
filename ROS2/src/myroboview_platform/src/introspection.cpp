#include "myroboview/introspection.hpp"
#include "myroboview/core.hpp"
#include <rosidl_typesupport_introspection_cpp/field_types.hpp>
#include <cmath>
#include <codecvt>
#include <locale>
#include <stdexcept>

namespace myroboview {
namespace {
using namespace rosidl_typesupport_introspection_cpp;
Json::Value object(const MessageMembers *members, const void *data, size_t &budget, int depth);
Json::Value numeric(double value) { return std::isfinite(value) ? Json::Value(value) : Json::Value(); }
Json::Value scalar(const MessageMember &m, const void *p, size_t &budget, int depth) {
  if (budget == 0 || depth > 16) throw std::runtime_error("Message exceeds nesting/element limits");
  --budget;
  switch (m.type_id_) {
    case ROS_TYPE_FLOAT: return numeric(*static_cast<const float *>(p));
    case ROS_TYPE_DOUBLE: return numeric(*static_cast<const double *>(p));
    case ROS_TYPE_LONG_DOUBLE: return numeric(static_cast<double>(*static_cast<const long double *>(p)));
    case ROS_TYPE_BOOLEAN: return *static_cast<const bool *>(p);
    case ROS_TYPE_CHAR: case ROS_TYPE_OCTET: case ROS_TYPE_UINT8: return *static_cast<const uint8_t *>(p);
    case ROS_TYPE_WCHAR: return static_cast<unsigned>(*static_cast<const char16_t *>(p));
    case ROS_TYPE_INT8: return *static_cast<const int8_t *>(p);
    case ROS_TYPE_UINT16: return *static_cast<const uint16_t *>(p);
    case ROS_TYPE_INT16: return *static_cast<const int16_t *>(p);
    case ROS_TYPE_UINT32: return *static_cast<const uint32_t *>(p);
    case ROS_TYPE_INT32: return *static_cast<const int32_t *>(p);
    case ROS_TYPE_UINT64: {
      auto v = *static_cast<const uint64_t *>(p);
      return v > 9007199254740991ULL ? Json::Value(std::to_string(v)) : Json::Value(Json::UInt64(v));
    }
    case ROS_TYPE_INT64: {
      auto v = *static_cast<const int64_t *>(p);
      return v > 9007199254740991LL || v < -9007199254740991LL ? Json::Value(std::to_string(v)) : Json::Value(Json::Int64(v));
    }
    case ROS_TYPE_STRING: return *static_cast<const std::string *>(p);
    case ROS_TYPE_WSTRING: return std::wstring_convert<std::codecvt_utf8_utf16<char16_t>, char16_t>{}.to_bytes(*static_cast<const std::u16string *>(p));
    case ROS_TYPE_MESSAGE: return object(static_cast<const MessageMembers *>(m.members_->data), p, budget, depth + 1);
    default: throw std::runtime_error("Unsupported ROS field type");
  }
}
Json::Value object(const MessageMembers *members, const void *data, size_t &budget, int depth) {
  Json::Value result(Json::objectValue);
  for (uint32_t i = 0; i < members->member_count_; ++i) {
    const auto &m = members->members_[i];
    const void *p = static_cast<const uint8_t *>(data) + m.offset_;
    if (!m.is_array_) { result[m.name_] = scalar(m, p, budget, depth); continue; }
    size_t size = m.size_function ? m.size_function(p) : m.array_size_;
    if (size > budget) throw std::runtime_error("Array exceeds element limit");
    Json::Value array(Json::arrayValue);
    for (size_t index = 0; index < size; ++index) {
      // std::vector<bool> has no stable element address.
      if (m.type_id_ == ROS_TYPE_BOOLEAN && m.fetch_function) {
        bool value = false; m.fetch_function(p, index, &value);
        array.append(scalar(m, &value, budget, depth));
      } else {
        if (!m.get_const_function) throw std::runtime_error("Missing array introspection accessor");
        array.append(scalar(m, m.get_const_function(p, index), budget, depth));
      }
    }
    result[m.name_] = std::move(array);
  }
  return result;
}
}
Decoder::Decoder(const std::string &type) {
  cpp_library_ = rclcpp::get_typesupport_library(type, "rosidl_typesupport_cpp");
  introspection_library_ = rclcpp::get_typesupport_library(type, "rosidl_typesupport_introspection_cpp");
  // This API is shared by Humble and Jazzy (deprecated only in newer versions).
  auto cpp = rclcpp::get_typesupport_handle(type, "rosidl_typesupport_cpp", *cpp_library_);
  auto meta = rclcpp::get_typesupport_handle(type, "rosidl_typesupport_introspection_cpp", *introspection_library_);
  members_ = static_cast<const MessageMembers *>(meta->data);
  serializer_ = std::make_unique<rclcpp::SerializationBase>(cpp);
}
Json::Value Decoder::decode(const rclcpp::SerializedMessage &message) const {
  constexpr size_t max_bytes = 128 * 1024;
  if (message.size() > max_bytes) throw std::runtime_error("Message exceeds 128 KiB; use a dedicated media/map adapter");
  void *data = ::operator new(members_->size_of_);
  try { members_->init_function(data, rosidl_runtime_cpp::MessageInitialization::ALL); }
  catch (...) { ::operator delete(data); throw; }
  auto cleanup = [this](void *p) { members_->fini_function(p); ::operator delete(p); };
  std::unique_ptr<void, decltype(cleanup)> storage(data, cleanup);
  serializer_->deserialize_message(&message, data);
  size_t budget = 8192;
  auto result = object(members_, data, budget, 0);
  if (encode(result).size() > max_bytes) throw std::runtime_error("JSON exceeds 128 KiB");
  return result;
}
}  // namespace myroboview
