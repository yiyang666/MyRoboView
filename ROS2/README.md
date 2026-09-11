# ROS2 工作区与操作手册

## 目录

```text
ROS2/
  src/myroboview_interfaces/   # ament_cmake；PlatformStatus.msg
  src/myroboview_platform/     # ament_cmake；C++17 / rclcpp
    include/myroboview/        # 配置、状态、消息反射、HTTP 边界
    src/                      # bridge / mock 与公共实现
    config/demo.json          # 网页与订阅共同配置
    web/                      # 后端诊断入口（主界面在 my-app）
    test/core_test.cpp        # 配置/状态/消息边界测试
  tests/integration.py        # 调用真实 C++ 进程的 DDS/HTTP 集成测试
```

主界面在仓库根 `my-app`，复用 RoboView React 组件与样式，通过 `/api/v1/state` 适配后端；前后端分别启动，见根 README。

运行时节点均为 C++。Python 仅用于 ROS 构建工具、rosidl 自动生成产物及集成测试编排，桥接和 Mock 不使用 rclpy。

## 从源码构建并运行

在仓库根目录执行 `./scripts/build.sh`、`./scripts/run_demo.sh`。构建脚本 source `/opt/ros/${ROS_DISTRO:-jazzy}/setup.bash`；Orin NX 原生 Humble 需先 `export ROS_DISTRO=humble`。不要在同一个 build/install 目录混用不同 ROS 发行版；切换发行版请用新的 clone 或独立工作区。

脚本同时启动两个独立 C++ 进程，任一退出则关闭另一个。它默认 `ROS_DOMAIN_ID=77`、`ROS_LOCALHOST_ONLY=1`，新 ROS 版本也设置 `ROS_AUTOMATIC_DISCOVERY_RANGE=LOCALHOST`。

若需要演示 Mock 停止、单话题断流，使用下列两个终端，而非同时启停脚本：

```bash
# 两个终端都先设置
source ROS2/install/setup.bash
export ROS_DOMAIN_ID=77
export ROS_LOCALHOST_ONLY=1

# 终端 A
ros2 run myroboview_platform bridge
# 终端 B
ros2 run myroboview_platform mock
# 警告场景：停止 B 后使用
ros2 run myroboview_platform mock --scenario warning
```

B 停止后页面仍连接 A，但各话题在自己的阈值后变为“已超时”；B 重启后自动恢复。删除某话题配置中的 `mock` 对象后，只停止该话题的模拟发布，bridge 仍可订阅它。

## 连接真实机器人

1. 复制 `src/myroboview_platform/config/demo.json` 为设备配置，修改 robot 信息、绝对话题名、完整消息类型及 QoS；移除 `mock` 项以免误作模拟配置。
2. 在桥接主机安装并 source 真实机器人的自定义消息包。必须含 `rosidl_typesupport_cpp` 与 `rosidl_typesupport_introspection_cpp`。
3. 停止 Mock。只运行 `ros2 run myroboview_platform bridge --config /absolute/path/robot.json`。
4. 桥接与机器人使用相同 ROS 发行版、消息定义、`ROS_DOMAIN_ID`；同机部署优先。跨机时按现场需求取消本机发现限制，检查 DDS/RMW 与防火墙。
5. 用 `ros2 topic list -t`、`ros2 topic info -v /topic`、`ros2 topic hz /topic` 排查，再对照页面接收频率与超时状态。网页 HTTP 存活不代表 ROS 数据存活。

配置修改后重启节点；本版不实现热加载。常规新消息只需配置；新的 Mock 生成器需要在 `src/mock.cpp` 中添加 C++ 填充逻辑。

## HTTP 协议

- `GET /`：后端诊断入口；React 主界面由 my-app 开发服务器或静态站点托管。
- `GET /api/v1/health`：进程服务存活，不代表所有话题正常。
- `GET /api/v1/state`：配置、逐话题最新消息及健康状态。
- 非 GET 方法返回 405；未知路径返回 404。

页面以配置的 `poll_ms`（默认 500 ms）串行轮询，3 秒请求超时，自动重试。没有 WebSocket 和历史数据库。每话题只保留一份最新 JSON 和最多 100 个接收时刻，接收频率使用最近 5 秒窗口；高频时最多覆盖最近 100 条。

## 测试

```bash
./scripts/test.sh
```

包括 C++ 单测和真实 C++ Mock → DDS → C++ bridge → HTTP 测试。后者使用 domain 178、本机发现和临时 HTTP 端口，测试停止 Mock、单话题缺失及重启恢复，结束会清理测试进程。
