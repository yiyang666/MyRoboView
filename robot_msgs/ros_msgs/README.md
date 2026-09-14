# 标准消息参考

本目录从本机 /opt/ros/jazzy/share 的对应包复制使用到的 .msg 定义及 upstream-package.xml（包含上游版本与许可元数据）。
包含 Imu 及 Header、Quaternion、Vector3、Time 依赖，方便阅读数据结构。
COLCON_IGNORE 明确禁止将这些快照作为独立包构建。真正的类型支持来自系统 ROS2 Jazzy 标准消息包；不要修改快照来改变标准消息类型。
