# 重构说明

## 选择

采用参考 LYOS 版、独立实现 ROS2 Demo 的路线。Master 保留原始业务版；develop 移除私有 SDK、产品宏、动作与标定依赖。前端保留 React 布局和组件，不升级工具链。

本次将上一版共享平台包拆成独立 robotapp 和 Drogon backend。二者只有 ROS 消息契约关联，不共享运行配置，也不互相启动。

## 职责

- robotapp：C++ / rclcpp 发布机器人状态、标准 IMU、电机健康。独立配置发布话题和频率，正常模式按时间转换状态，fault 场景模拟异常。
- robot_msgs/node_app_msgs：RobotState、MotorHealth、MotorHealthArray 的唯一自定义定义，colcon 生成类型支持。
- robot_msgs/ros_msgs：本机 Jazzy 标准消息参考快照及上游 package 元数据；不创建同名 ROS 包。编译链接系统标准消息，避免类型冲突。
- myroboview/backend：Drogon HTTP/WebSocket、rclcpp 通用订阅、ROS introspection 转 JSON、缓存和按配置频率广播。配置类型必须已安装类型支持。
- myroboview/frontend：原 React 目录整体迁移，完整协议和导航适配后续完成。
- scripts：保留三个入口，更新为独立包路径；启动脚本退出清理自己的两个进程。

ROS 接收与网络发送分线程，缓存和客户端集合有锁保护。广播频率独立于接收频率，只发送最新缓存，waiting/stale/error 状态明确随帧发出。

## 导航来源与边界

参考 `/home/ethan/workspace/RoboView_history/roboview` 的 `release/lrd-w/rk3588/v1.1.0`（实际为 tag），提交 `ff313d860167a92dde432ab710920b17faaaaf0d`。
沿用测试地图、五个预置目标点和路线数据，重写独立导航状态逻辑。支持内存中的目标点/路线增删、启动、暂停、继续、停止、到点完成。重启恢复预置数据。

导航按直线路段插值，不做规划、避障、定位或真实机器人控制。无 LYOS 依赖，不扫描真实机器地图、资源或日志路径。

## 未完成事项

前端状态栏/导航适配、生产认证、慢客户端背压、长期压力测试、真实机器人接口与 Orin NX 部署均未完成。默认回环监听，导航写接口仅改变本地模拟状态。
