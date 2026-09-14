# MyRoboView 开发约定

- Master 是 LYOS 原始快照，后续在 develop 开发。
- 当前优先 x64 Ubuntu 24.04 / ROS2 Jazzy；目标硬件 Orin NX，部署与安装文档后置。
- robotapp 为独立 C++ / rclcpp 模拟程序；myroboview/backend 为 Drogon C++ 后端，二者独立配置。
- 自定义消息在 robot_msgs/node_app_msgs；标准消息参考快照在 robot_msgs/ros_msgs，实际链接系统 ROS 消息。
- 前端在 myroboview/frontend，复用原 React 组件，不顺带升级工具链。
- 配置分别在 robotapp/config 和 myroboview/backend/config。
- 不引入 LYOS SDK、业务动作或标定；资源健康、日志本阶段不做。
- 导航仅后端内存模拟，不发 ROS 控制指令。默认回环监听。
- 真实 app 接入仅启动 backend，不同时启动发布同名话题的 robotapp。
- 验证使用 ./scripts/build.sh、./scripts/test.sh；前端构建 CI=true npm run build --prefix myroboview/frontend。
- 测试完成必须关闭自己启动的前端、后端和 robotapp，核实端口释放，让用户自行启动；不遗留后台服务。
- 不清理用户未跟踪文件、缓存和旧构建产物。遵守 .gitignore。
- 路线与范围见 ROS2/ROADMAP.md、ASSESSMENT.md、REFACTOR.md；没有实机证据不能标记部署完成。
