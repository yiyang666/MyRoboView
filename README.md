# MyRoboView

通用、配置驱动的机器人监控运维平台。当前是 **ROS2 C++ 只读监控基线**：独立 C++ Mock → ROS2 DDS → C++ 桥接服务 → 浏览器。目标设备为 **Jetson Orin NX**。

## 分支

- `Master`：复制进来的 LYOS develop 原始源码快照，首次提交 `42a39bf`，供比较和按需迁移。
- `develop`：通用 ROS2 平台开发。当前采用“参考 LYOS 版重建最小 ROS2 Demo”的路线。
- 仓库默认私有。原工程许可证声明不一致，尚未重新授权或公开发行。

## 快速启动

已安装 ROS2 Jazzy（Ubuntu 24.04）或 Humble（Ubuntu 22.04），并有 C++ 编译工具、colcon、Boost.System、JsonCpp：

```bash
# 系统依赖（首次安装；先按 ROS 官方说明配置 ROS apt 源）
sudo apt install build-essential cmake python3-colcon-common-extensions libboost-system-dev libjsoncpp-dev
# 以下按本机实际发行版设置；Orin NX + JetPack 6.x 原生部署使用 humble
export ROS_DISTRO=jazzy
sudo apt install ros-$ROS_DISTRO-ros-base ros-$ROS_DISTRO-sensor-msgs ros-$ROS_DISTRO-nav-msgs ros-$ROS_DISTRO-rosidl-default-generators ros-$ROS_DISTRO-rosidl-typesupport-introspection-cpp
./scripts/build.sh
./scripts/run_demo.sh
```

后端检查页：[http://127.0.0.1:8080](http://127.0.0.1:8080)。`Ctrl+C` 结束两个 C++ 节点。

前端复用原 RoboView 的 React 布局、侧栏、状态栏和监控卡片样式，仅适配 ROS2 数据；另开终端：

```bash
cd my-app
npm ci  # 已有完整 node_modules 时可以跳过
HOST=127.0.0.1 BROWSER=none npm start
```

访问 [http://127.0.0.1:3000](http://127.0.0.1:3000)。开发代理把 `/api` 转给 C++ 后端 8080。前端生产构建：`npm run build --prefix my-app`。

```bash
./scripts/test.sh
MYROBOVIEW_SCENARIO=warning ./scripts/run_demo.sh
./scripts/run_demo.sh --config /absolute/path/robot.json
```

默认使用 ROS domain 77、本机发现；Mock 使用 `/myroboview/demo/*`，不会下发任何控制消息。真实接入只启动 `bridge`，详见 [ROS2 操作手册](ROS2/README.md)。

Demo 以主要后端功能为验收目标。前端完整迁移、3D、曲线、导航和生产运维均不作为本轮门槛。

## 当前能力

- 配置决定话题、消息类型、QoS、超时阈值及页面指标字段。
- C++ 通用订阅 + introspection，支持已安装的标准/自定义消息包，无需修改桥接代码。
- 电池、IMU、关节、里程计及自主定义的 `PlatformStatus` Mock。
- 每话题在线/等待/超时/错误状态、接收频率、消息计数、原始 JSON 检查器。
- 复用 RoboView React 界面；同源代理到只读 API，浏览器断线自动重连。
- 无运动控制、业务导航、标定、地图编辑、LYOS 依赖或产品模型资源。

## 文档入口

| 文档 | 内容 |
|---|---|
| [功能与工作量评估](ROS2/ASSESSMENT.md) | 原版功能证据、耦合点、风险、阶段人日 |
| [重构决策与裁剪说明](ROS2/REFACTOR.md) | 两条路线比较、删除项、保留项、回溯方式 |
| [完整 ROS2 平台化计划](ROS2/ROADMAP.md) | 架构、阶段交付、验收门槛、后续实现顺序 |
| [配置与消息契约](ROS2/CONTRACTS.md) | 字段映射、QoS、自定义消息语义及限制 |
| [Orin NX 部署方案](ROS2/ORIN_NX.md) | Humble/JetPack 基线、构建、SSH、运维与回滚 |
| [验证记录](ROS2/VALIDATION.md) | 实测环境、测试结果、尚未验证部分 |

## 首次提交范围

`Master` 保留 189 个文件，包括原前后端、产品配置与发布用 GLB/URDF。新增根 `.gitignore` 排除了现场认证文件 `backend/config/auth/auth_users.json`，示例认证文件保留。原项目已忽略的 `node_modules`、前端 build、原始 STL 工具输入及 public 模型副本不入库；这些本地文件未被清理。原始 STL 中有超过 GitHub 单文件 100 MB 限制的文件，后续如需归档，应单独采用 Git LFS。
