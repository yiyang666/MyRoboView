# MyRoboView

基于 RoboView 的通用机器人监控 Demo。原 LYOS 快照保留在 `Master`，开发在 `develop`。
当前优先验证 x64 / Ubuntu 24.04 / ROS2 Jazzy / C++；Orin NX 部署后续安排。

```text
robotapp/                  独立 ROS2 C++ 模拟机器人进程
robot_msgs/node_app_msgs/   自定义 ROS2 消息包
robot_msgs/ros_msgs/        标准消息定义参考快照
roboview/                  colcon 包（前后端同级，体系说明见 roboview/README.md）
roboview/backend/          Drogon C++，订阅、缓存、WebSocket、导航模拟
roboview/frontend/         React 实时监控、电机健康卡片、2D 地图导航
scripts/                   保留构建、测试、启动入口
ROS2/                      评估、方案、协议与验证文档
```

数据链路：`robotapp → ROS2 DDS → backend → WebSocket /ws → frontend`。
两个进程各自读取配置，backend 不启动或依赖 robotapp；真实机器人接入时只启动 backend。
地图导航按钮由 backend 发布 `/iot/command`（`node_app_msgs/msg/IotCmdMsg`），导航任务同时在 backend 内模拟。资源健康、日志模块不在本阶段范围。
后端程序为 `myroboview_server`：`main.cpp` 负责启动和退出，`ros_subscriber.cpp` 负责接收话题，`command_publisher.cpp` 负责下发命令。

## 本机手动验证

统一构建在外层 `build_all_robot` 进行（colcon）：源码由 `make vcs_<产品>_<平台>` 以 git clone 形式拉取到其 `src/` 下，日常开发直接在该工作区进行；产物在 `../build_all_robot/build/<产品>/x86_64/install/`：

```bash
./scripts/build.sh            # 调外层构建体系编译 src/ 中的源码，-p lrd-w 切换产品
./scripts/test.sh             # 单元测试 + 真实 DDS 集成测试
```

无外层体系时（如 CI）使用仓内独立构建：`./scripts/build.sh --local` 与 `./scripts/test.sh --local`，产物在本仓 `install/`。

开发模式启动（x86_64）：robotapp 单独一个终端，前后端由 start_dev.sh 一起拉起：

```bash
# 终端一：robotapp mock（真实机器人接入时勿启动，避免同名话题冲突）
./scripts/run_robotapp.sh
# 终端二：后端 :8080 + 前端 :3000，Ctrl+C 会按进程组清理前端整棵树
./scripts/start_dev.sh        # -p lrd-w 切换产品；--no-browser 不自动打开浏览器
```

浏览器打开 http://127.0.0.1:3000；后端检查入口为 http://127.0.0.1:8080/api/v1/health。
无前端联调时可沿用 `./scripts/run_demo.sh`（同终端拉起 robotapp + backend，Ctrl+C 关闭二者）。

安装布局与原项目对齐：`install/bin/` 为可执行文件，`install/etc/` 为配置与前端静态页（`etc/web_config/`、`etc/robotapp/`、`etc/web/`）。
自定义配置可通过 `ROBOTAPP_CONFIG` 和 `MYROBOVIEW_CONFIG` 环境变量指定（仅 run_demo.sh）。

电机状态默认显示 16 个模拟电机，可切换 LRD-W 关节名或消息原始名称。URDF 原始资源保存在前端 `assert`，当前只复用原版关节映射，不加载 3D。
地图导航复用原版 2D 画布：地图管理可加载地图、选点新增、按顺序创建线路；导航控制可建图/定位、开始/暂停/恢复/终止任务。建图只模拟状态，不产生真实 SLAM 地图。
前端 WebSocket 使用 `/api/v1/telemetry`，后端兼容 `/ws`；避开 React 开发服务器的热更新通道。

方案见 [ROS2 文档](ROS2/README.md)。
