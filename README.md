# MyRoboView

基于 RoboView 的通用机器人监控 Demo。原 LYOS 快照保留在 `Master`，开发在 `develop`。
当前优先验证 x64 / Ubuntu 24.04 / ROS2 Jazzy / C++；前端适配、Orin NX 部署后续安排。

```text
robotapp/                  独立 ROS2 C++ 模拟机器人进程
robot_msgs/node_app_msgs/   自定义 ROS2 消息包
robot_msgs/ros_msgs/        标准消息定义参考快照
myroboview/backend/        Drogon C++，订阅、缓存、WebSocket、导航模拟
myroboview/frontend/       复用原 React 前端，完整新协议适配待后续
scripts/                   保留构建、测试、启动入口
ROS2/                      评估、方案、协议与验证文档
```

数据链路：`robotapp → ROS2 DDS → backend → WebSocket /ws → frontend`。
两个进程各自读取配置，backend 不启动或依赖 robotapp；真实机器人接入时只启动 backend。
导航 Demo 在 backend 内模拟，不向 ROS 下发运动命令。资源健康、日志模块不在本阶段范围。

## 本机手动验证

使用已有依赖，无需重新安装环境：

```bash
./scripts/build.sh
./scripts/test.sh
./scripts/run_demo.sh
```

最后一条在当前终端启动 robotapp 和 backend；按 Ctrl+C 会关闭二者。不会启动前端或注册后台服务。
浏览器打开 http://127.0.0.1:8080 查看后端检查入口。

也可以分别在两个终端启动（以下使用 bash；zsh 对应使用 setup.zsh）：

```bash
source /opt/ros/jazzy/setup.bash
source install/setup.bash
export ROS_DOMAIN_ID=77
export ROS_AUTOMATIC_DISCOVERY_RANGE=LOCALHOST
# 终端一：
ros2 run robotapp robotapp_node --config "$PWD/robotapp/config/robotapp.json"
# 终端二：同样加载环境后执行
ros2 run myroboview_backend myroboview_backend_node --config "$PWD/myroboview/backend/config/myroboview.json"
```

分别按 Ctrl+C 关闭。自定义配置也可通过启动脚本的 `ROBOTAPP_CONFIG` 和 `MYROBOVIEW_CONFIG` 环境变量指定。
前端如需查看现有页面，在第三个终端运行 `npm start --prefix myroboview/frontend`，按 Ctrl+C 关闭；新状态字段和导航页面尚待适配，不作为本轮验收入口。

方案见 [ROS2 文档](ROS2/README.md)。
