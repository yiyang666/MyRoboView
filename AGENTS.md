# MyRoboView 开发约定

- Master 是 LYOS 原始快照，后续在 develop 开发。
- 当前优先 x64 Ubuntu 24.04 / ROS2 Jazzy；目标硬件 Orin NX，部署与安装文档后置。
- robotapp 为独立 C++ / rclcpp 模拟程序；roboview/backend 为 Drogon C++ 后端，二者独立配置。
- 自定义消息在 robot_msgs/node_app_msgs；标准消息参考快照在 robot_msgs/ros_msgs，实际链接系统 ROS 消息。
- 当前版本 **Demo 2.0**；前端在 roboview/frontend，React + Vite 6（2026-09 自 CRA 迁移，约定见 roboview/README.md）。
- 配置分别在 robotapp/config 和 roboview/backend/config/<产品>/（按产品拆分，构建时只安装当前产品）。
- 不引入 LYOS SDK、业务动作或标定；资源健康、日志本阶段不做。
- 后端入口 main.cpp，订阅在 ros_subscriber.cpp，发布在 command_publisher.cpp；程序名 roboview。
- 导航按钮经后端发布 /iot/command（node_app_msgs/msg/IotCmdMsg），任务同时驱动内存导航模拟。遵循 ROS2_DOCS/CONTRACTS.md 的参数格式。默认回环监听。
- 前端本轮包含电机健康卡片与原版 2D 地图导航，不加入 3D 动态展示；用户保留的 assert 资源不可清理。
- 真实 app 接入仅启动 backend，不同时启动发布同名话题的 robotapp。
- 验证使用 ./scripts/build.sh、./scripts/test.sh；前端手工构建 REACT_APP_PRODUCT=<产品> npm run build --prefix roboview/frontend。
- 测试完成必须关闭自己启动的前端、后端和 robotapp，核实端口释放，让用户自行启动；不遗留后台服务。
- 不清理用户未跟踪文件、缓存和旧构建产物。遵守 .gitignore。
- 外层的make clean 相关指令只会清空 build/ 目录。
- 路线与范围见 ROS2_DOCS/ROADMAP.md、ASSESSMENT.md、REFACTOR.md；没有实机证据不能标记部署完成。
- 系统集成测试位于仓根 integration_tests/；test_reports/ 按产品和运行时间归档，不提交报告。
