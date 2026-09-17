# 验证记录

2026-09-14，本机 x64 Ubuntu 24.04 / ROS2 Jazzy：

- `./scripts/build.sh`：三个独立包编译通过。
- `./scripts/test.sh`：两项 C++ 测试及真实 DDS + Drogon HTTP/WebSocket 集成测试通过。
- `CI=true npm run build --prefix myroboview/frontend`：构建通过（未启动前端服务）。
- `scripts/run_demo.sh`：实际启动后发送 Ctrl+C，两个子进程均退出，8080/3000 无监听。
- 覆盖：独立配置与话题改名、状态/IMU/电机字段、广播限频、多客户端、失联与恢复、故障场景、导航增删/冲突/移动/暂停/继续/停止/完成、禁用导航和进程正常退出。

测试使用临时端口和独立 ROS domain，finally 清理自己启动的进程。用户验收需自行手动启动。
此处以上为目录拆分基线记录；未进行 Orin NX 实机部署。历史 Humble 结果不代表此次 Drogon 版本通过 Humble 验证。

## Demo 0.3 迭代验证（2026-09-14）

- 后端程序改名 myroboview_server，拆分 main / ros_subscriber / command_publisher；本机三个包构建通过。
- 两项 C++ 测试和 DDS/HTTP/WS 集成测试通过。新增独立 rclpy 观察者实际接收 /iot/command，逐条比较 MAP/LOC/NAV 的四个字段与发布顺序；拒绝请求不会产生额外消息。验证发布异常时模拟状态不推进。
- 发布器在 Drogon 结束后显式释放，SIGTERM 与启动脚本 Ctrl+C 测试正常退出。
- React 生产构建通过。浏览器实际验证实时状态、16 个电机卡片、LRD-W 关节名、2D 底图、加载地图、选点新增及方向、保存线路、启动/暂停/恢复/终止导航。
- 浏览器验证后端退出后显示离线并禁用控制，重连时重新获取资源。业务 WebSocket 使用 /api/v1/telemetry，兼容 /ws，避开 CRA 热更新通道。
- 未进行 3D 展示、真实机器人命令执行或 Orin NX 实机测试。建图为指令与状态模拟，不生成 SLAM 地图。

上一版 GitHub CI 因发行版 Drogon 的 CMake 依赖缺少 PostgreSQL 开发库而失败；本轮 CI 补充数据库与 Brotli 链接依赖，与本机既有依赖环境分开验证。

## Vite 与新安装布局评审（2026-09-16）

评审基线为 `9fe77b58a849`。本机依次执行两产品完整测试：

- `./scripts/test.sh -p lrs-x`：全部通过；持久报告 `test_reports/lrs-x/20260916T133933.096251Z/`。
- `./scripts/test.sh -p lrd-w`：全部通过；持久报告 `test_reports/lrd-w/20260916T133944.980666Z/`。
- 覆盖单元测试结果、产物负例、产品/身份一致性、Vite 入口资源、真实 DDS + HTTP + WebSocket，并生成 JUnit、元数据和阶段日志。

上述通过结论只证明当前测试声明的范围。实物审计另发现：旧 LRS-X 安装前缀仍有 CRA 和旧资源路径残留，而检查器只对 `static/` 做完整集合比较；干净 Git 检出也缺少 CMake 强制要求的私有认证 JSON。因此尚不能声明“旧版原地升级目录干净”或“当前 CI 可从零构建”。详见 [问题跟踪](OPTIMIZED.md) 与本轮代码评审。

## Demo 2.0 发布（2026-09-17）

**标签**：`demo v2.0` · **分支**：`develop`

相对 Demo 1.0 的主要变更：

- 前端构建框架 **CRA/react-scripts → Vite 6**（依赖约 1330→13 包，全量构建 <1s；代理/产品注入收敛到 `vite.config.js`）
- 安装前 **整目录清空 `etc/web`** 再重生，消除 CRA 旧布局与异产品资源残留（BUG-05）
- 认证 **auth_users.example.json** 入库，干净检出/CI 可构建（BUG-04）；登录未启用
- 开发/生产 **URDF URL 统一**为 `/assets/robot_urdf/`（BUG-06）
- `.gitignore` 分层：`roboview/.gitignore`（前后端包）+ 仓根 `.gitignore`

发布前本机验证（x64 / Jazzy）：

- `make lrd-w_x86_64` / `make lrs-x_x86_64`：colcon + Vite 构建安装通过
- `./scripts/test.sh -p lrs-x` / `-p lrd-w`：单元、产物、DDS/HTTP/WebSocket 全通过
- `./scripts/start_dev.sh -p lrd-w`：Vite dev + 后端联调正常

未纳入本版范围：浏览器 E2E 自动化、Orin NX 部署、3D viewer、真实导航闭环。
