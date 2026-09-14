# 验证记录

2026-09-14，本机 x64 Ubuntu 24.04 / ROS2 Jazzy：

- `./scripts/build.sh`：三个独立包编译通过。
- `./scripts/test.sh`：两项 C++ 测试及真实 DDS + Drogon HTTP/WebSocket 集成测试通过。
- `CI=true npm run build --prefix myroboview/frontend`：构建通过（未启动前端服务）。
- `scripts/run_demo.sh`：实际启动后发送 Ctrl+C，两个子进程均退出，8080/3000 无监听。
- 覆盖：独立配置与话题改名、状态/IMU/电机字段、广播限频、多客户端、失联与恢复、故障场景、导航增删/冲突/移动/暂停/继续/停止/完成、禁用导航和进程正常退出。

测试使用临时端口和独立 ROS domain，finally 清理自己启动的进程。用户验收需自行手动启动。
本轮未验证完整 React 新协议交互，未进行 Orin NX 实机部署。历史 Humble 结果不代表此次 Drogon 版本通过 Humble 验证。
