cmake_minimum_required(VERSION 3.16)
project(node_app_msgs)
find_package(ament_cmake REQUIRED)
find_package(rosidl_default_generators REQUIRED)
find_package(std_msgs REQUIRED)
# 消息清单：MotorHealth 为数组载体（bounded sequence），元素类型 MotorHealthState 必须单独注册
rosidl_generate_interfaces(${PROJECT_NAME}
    "msg/RobotState.msg"
    "msg/MotorHealth.msg"
    "msg/MotorHealthState.msg"
    "msg/IotCmdMsg.msg"
    DEPENDENCIES std_msgs
)
ament_export_dependencies(rosidl_default_runtime)
ament_package()
