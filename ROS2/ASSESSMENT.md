# 功能现状与工作量评估

评估日期：2026-09-11。源版本：`Master@42a39bf`（用户复制的 LYOS develop；没有原仓库提交历史，因此不把它当作可验证的原仓库 develop HEAD）。目标：Orin NX、ROS2 C++、配置驱动的通用监控运维平台。

## 结论

原版是已有较多现场能力的 LYOS 产品应用，并非只差一个 ROS2 订阅替换层。`ament_cmake` 仅说明它使用 ROS 风格构建；实际数据与命令仍通过 LYOS、业务消息、共享内存和原工程库实现。最短可验证路线是**保留 Master，develop 重建小型 ROS2 C++ 后端并适配原前端**，随后按能力逐项迁移。

本轮已交付主要后端能力与最小 React 数据适配。**Demo 不要求全功能；优先后端，前端复用原 RoboView。** 若只做 Orin NX 上的 Demo 编译、Mock/真实话题联调与记录，预计另需 **2–4 人日**（需要板端环境）。后续达到可部署的通用只读监控 MVP，预计另需 **7–11 人日**；完成包含配置工具、基础运维、板端长稳与发布流程的第一阶段平台，预计另需 **20–31 人日**，加 25% 联调余量约 **25–39 人日（单人 5–8 周）**。运动控制、Nav2 任务及复杂地图编辑不包含在该估算内。

## 代码规模与证据口径

按复制目录静态统计，不含 node_modules、构建产物及模型资源：

- 后端：19 个 `.cpp/.h`，约 7,412 行。
- 前端：86 个 `.js/.css`，约 13,991 行。
- 本地目录约 1.7 GB，主要来自依赖、模型及重复产物；发布用 assets 约 163 MB。
- 本次未找到自有自动化测试文件；原版 README 中提到的 backend Makefile/CMakeLists 等在复制目录中不存在，不能据文档断言可独立构建。
- 原版未进行硬件行为验证或完整运行；以下“已有”表示代码存在，不能等同现场验收通过。

## 功能评估与裁剪映射

以下源证据链接固定到原始提交，develop 裁剪后仍可访问。

| 能力 | 当前代码与耦合 | 本轮处理 | 后续通用方向 |
|---|---|---|---|
| 整体界面、桌面/操作员模式 | [App.js](https://github.com/yiyang666/MyRoboView/blob/42a39bf/my-app/src/App.js) 聚合状态、路由、产品模式和权限 | 复用 React 布局、侧栏/状态栏结构与卡片样式，裁剪为只读入口 | 其余组件按需适配，非 Demo 门槛 |
| ROS/LYOS 接入 | [lyos_subscriber.cpp](https://github.com/yiyang666/MyRoboView/blob/42a39bf/backend/src/lyos_subscriber.cpp) 使用 LYOS 和业务消息，回调直接组装 JSON | 移除 LYOS 运行依赖 | rclcpp 泛型订阅、反射解码、独立状态缓存 |
| 电池与系统状态 | 原订阅器部分状态调用传入固定 48V、100% 等值；业务状态枚举来自 LrsState | 标准 BatteryState + 自定义 PlatformStatus | 各 app 发布适配状态，未知不伪造正常 |
| 关节/电机健康 | 原版固定 motor_count、索引、健康码区间、版本位字段 | 标准 JointState 基础遥测；移除电机健康规则 | 名称映射 + diagnostics；硬件错误码留给设备适配层 |
| IMU/传感器 | 原订阅器、[SensorData.js](https://github.com/yiyang666/MyRoboView/blob/42a39bf/my-app/src/components/pages/SensorData.js) | 保留 IMU 遥测，移除开关业务服务 | 通用图表、采样率与 QoS 诊断 |
| CPU/内存监控 | node_system_manager 自定义资源消息 | PlatformStatus 演示百分比 | 节点/主机指标分层，真实资源采集器 |
| URDF 3D | [Robot3DView.js](https://github.com/yiyang666/MyRoboView/blob/42a39bf/my-app/src/components/Robot3DView.js)、两种产品模型/关节映射 | 不带入首版运行包 | 可配置 URDF/TF + 标准 JointState；模型单独管理 |
| 动作、模式、摇杆、键盘、语音 | [api_handlers.cpp](https://github.com/yiyang666/MyRoboView/blob/42a39bf/backend/src/api_handlers.cpp)、controlCatalog 等直接依赖业务服务 | 全部移出运行版 | 后续能力插件，单独设计授权/失联归零/限速 |
| 标定 | 管理员接口 + 专属电机服务 | 移除 | 设备插件，不成为平台默认功能 |
| 地图与导航 | [nav_manager.cpp](https://github.com/yiyang666/MyRoboView/blob/42a39bf/backend/src/nav_manager.cpp)、[nav_map_io.cpp](https://github.com/yiyang666/MyRoboView/blob/42a39bf/backend/src/nav_map_io.cpp) 混合任务、建图、地图落盘、产品状态 | 移除控制及管理接口；首版只有里程计 | 先通用只读 Map/Path/TF，再独立 Nav2 action 插件 |
| 日志/包下载 | [lyos_data_provider.cpp](https://github.com/yiyang666/MyRoboView/blob/42a39bf/backend/src/lyos_data_provider.cpp)、LYOS SHM 和本机路径 | 移除 | /rosout、诊断事件、受限目录下载、rosbag2 管理 |
| 登录/RBAC | [auth_service.cpp](https://github.com/yiyang666/MyRoboView/blob/42a39bf/backend/src/auth_service.cpp)、JWT、固定账号角色 | 不沿用账号与密钥；Demo 仅回环监听 | 联网运维前重建身份、会话与审计 |
| 配置 | [view_config.h](https://github.com/yiyang666/MyRoboView/blob/42a39bf/backend/include/view_config.h) 已支持部分话题名和频率，但类型与转换仍写死 | 单一版本化 JSON 配置 | 配置校验工具、profile、能力声明与迁移机制 |
| 构建/部署 | [CMakeLists.txt](https://github.com/yiyang666/MyRoboView/blob/42a39bf/CMakeLists.txt) 依赖 lyoslib、robot_ai_common、/opt/npm 与产品宏；[start_dev.sh](https://github.com/yiyang666/MyRoboView/blob/42a39bf/start_dev.sh) 依赖原工作区 | 独立 ament C++ 工作区 | Humble/Jazzy 验证、arm64 制品与服务化 |

## 为什么不是直接改订阅器

1. 数据结构、API、页面都携带 LRS/LRD 状态语义。替换传输层不能消除枚举、错误码和关节顺序依赖。
2. 导航任务、动作脚本、标定等需要真实机器人服务契约；没有这些契约时保留按钮会制造错误能力承诺。
3. 单例状态和直接 WebSocket 广播使协议转换、业务判断和输出耦合；必须建立明确边界才能测试。
4. 原工程部署目录、私有库和大模型资源阻碍独立 clone 后复现。

## 工作量拆分

人日是工程规划估算，包含实现、自测与文档，不是本次对话实际耗时。

| 阶段 | 交付 | 预计人日 | 依赖/验收 |
|---|---|---:|---|
| P0 基线 | 仓库、分支、裁剪、C++ Mock/bridge、配置、方案 | 2–3 的常规工程预算；本轮已形成首版 | 本机编译、真实 DDS 测试 |
| P1 契约加固 | profile/schema、字段存在性检查、QoS 定位、消息兼容测试 | 3–5 | 两个不同机器人配置无需修改核心 |
| P2 Orin 只读 MVP | Humble arm64 构建、真实 app 话题、SSH、systemd、资源记录 | 4–6 | Orin NX 真实数据 + 8 小时运行 |
| P3 通用展示（可选后续） | 曲线/历史窗口、可配置 URDF、TF、Map/Path 只读 | 4–6 | 有标准模型/坐标系与数据样例 |
| P4 基础运维 | 身份权限、诊断/日志、受限导出、审计与反向代理 | 5–8 | 身份与数据保存需求确定 |
| P5 工程化 | 发布包、arm64 CI、配置升级回滚、长稳/负载、故障手册 | 4–6 | 24 小时长稳、升级回滚演练 |
| 合计剩余 P1–P5 | 第一阶段通用平台 | **20–31** | 加 25% 余量 **25–39** |

如要求迁移运动控制、Nav2 任务、地图编辑等原版操作能力，另估 **8–15 人日或更多**，需要真实服务定义与现场联调。多机器人集中管理、视频/点云、远程 OTA、云端多租户不计入本计划。

## 主要不确定性

- Orin NX 的实际 JetPack、内存、存储和现有 ROS 发行版尚未获取；本轮只固定目标型号，不升级/刷写设备。
- 第三方 app 是否提供标准消息、合理 QoS、稳定 frame_id；不一致时需要 app 适配层。
- 通用订阅不等于通用业务理解：字段映射可通用，告警语义和控制能力必须由契约定义。
- 高频大数据不能直接全量 JSON 轮询；图像、点云、地图要用独立采样/二进制通道。
- 原版包声明 Apache 2.0，但后端文档又写内部项目；本仓库保持私有，不新增开源授权承诺。
