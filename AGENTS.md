# MyRoboView 开发约定

- `Master` 是 LYOS 原始快照，不在该分支进行后续开发；默认在 `develop` 工作。
- 用户明确的目标：Jetson **Orin NX**；ROS2 后端和 Mock 使用 **C++ / rclcpp**。
- Demo 阶段以主要后端能力与真实 DDS 链路为重点，不要求完整功能。
- 前端优先复用原 RoboView React 布局/组件，通过适配层接入新协议；不要为 Demo 重建整套前端或顺带升级工具链。
- 路线、范围与估算以 `ROS2/ROADMAP.md`、`ROS2/ASSESSMENT.md`、`ROS2/REFACTOR.md` 为入口。
- 原版组件可以从 `Master:<path>` 查看/恢复；不要重新引入 LYOS 私有 SDK、产品宏、动作/标定业务路径。
- 自定义消息在 `ROS2/src/myroboview_interfaces`；配置在 `ROS2/src/myroboview_platform/config`。
- 后端验证：`./scripts/build.sh` 和 `./scripts/test.sh`；前端改动运行 `CI=true npm run build --prefix my-app`。
- 本机 Jazzy 测试与 Orin Humble/arm64 测试分开记录；没有实机证据不得标记部署完成。
- Demo 只读、回环监听；真实 app 接入时只启动 bridge，不同时启动相同话题的 Mock。
- 配置、认证文件、依赖缓存和构建产物遵守 `.gitignore`；不要清理用户遗留的未跟踪文件。
