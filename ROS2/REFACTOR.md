# 重构决策与首版裁剪说明

## 决策：选择方案二

采用“参考 LYOS 版建立 ROS2 Demo”。当前运行目录只保留通用 C++ ROS2 监控链路。原版全部已跟踪代码及发布资源保存在 `Master@42a39bf`，不在 develop 留一套仍能被误启动的 LYOS 业务后端。

| 比较项 | 方案一：原业务版内逐项删除 | 方案二：独立 ROS2 Demo（采用） |
|---|---|---|
| 复用界面 | 初期更多 | 复用原 React 布局与可用组件，仅替换数据适配 |
| 旧耦合风险 | 需跨订阅/API/状态/页面联动修剪 | 核心从 ROS2 契约开始 |
| 首轮验证 | 容易被私有库、导航服务、产品模型阻塞 | 独立 Mock 即可端到端验证 |
| 迁移规模 | 容易顺带迁移不需要的业务 | 按需单独迁移能力 |
| 代价 | 回归矩阵大，裁剪容易遗漏入口 | 3D/曲线等成熟页面需后续迁入 |

原版已有的动态话题配置、状态显示、独立连接状态等思路保留，但不维持旧 `/api/v1/control/*` 和 WebSocket 业务协议兼容。

## 变更清单

| 旧路径（Master） | develop 处理 | 原因/替代 |
|---|---|---|
| `backend/` 已跟踪代码和配置 | 删除 | ROS2/src 内 C++ bridge、mock、core 取代；本地未跟踪认证文件仍留在磁盘 |
| `my-app/src` | 按需保留/适配 | 复用 App/Sidebar/StatusBar/Page 样式与 Sidebar、StatusBar、SystemInfo 结构，新增只读 ROS2 App/hook；删除业务操作页面 |
| `my-app/package*.json`、基础 public | 保留 | 沿用已有 React 工具链，Demo 阶段不扩大为前端重构；依赖精简另行处理 |
| `my-app/assets` | 移出当前版本 | 大型产品模型在 Master 可回溯，Demo 不需加载 |
| `my-app/.gitignore` | 保留 | 继续隐藏原本地缓存、STL 工具输入、public 模型副本 |
| 根 CMakeLists/package.xml/package-lock | 删除 | 独立 ROS2 工作区中两个 ament 包，避免根包吞掉子包发现 |
| `start_dev.sh` | 删除 | scripts/build.sh、run_demo.sh、test.sh |
| `nginx/` 原脚本/配置 | 删除 | 原路径/业务 API 不再适用；Orin 文档提供新部署方案 |
| 旧 README/架构/构建/导航文档 | 替换/删除 | 根 README 和 ROS2 目录建立新的事实入口 |

不清理用户本地已忽略的 node_modules、build、STL 和认证文件；它们不参与新构建，也不推送远程。`Master` 没有修复原代码格式、改写业务或改造原构建。首次快照仅新增必要忽略规则。

## 本轮的技术边界

- 两个 ROS 包：`myroboview_interfaces` 定义契约；`myroboview_platform` 提供 C++17 `bridge` 与 `mock` 可执行文件。
- 使用 `rclcpp::create_generic_subscription` 和 ROS C++ introspection；类型支持库按配置动态加载，不关联 LYOS SDK。
- HTTP 使用 Boost.Beast，JSON 使用 JsonCpp；相比旧 Drogon，基础依赖可以通过 Ubuntu 系统包独立安装，无需原工程库。后续若运维接口需要成熟 Web 框架，可以在 HTTP 边界内替换。
- 前端复用原 RoboView React 工程及布局/组件结构，只新增 `useRos2State` 适配只读快照。主界面 3000 代理至后端 8080；后端自带一个极小诊断入口。Demo 不追求完整前端功能，也不做工具链升级。
- 保留原 package/lock 便于直接复用本机依赖；其中 3D 等依赖暂未在 App 导入，不代表功能已迁移。后续需要时从 Master 迁入相应组件。
- Mock CPU/内存、电量等均为合成数据，不宣称是运行主机的真实指标，也不是物理仿真器。
- 当前只读，无认证页面，绑定 127.0.0.1；远程通过 SSH 隧道。添加写操作前需单独实现授权、审计及机器人侧保护。

## 回溯与后续迁移

```bash
# 在单独目录查看完整初始版本，避免影响 develop 工作目录
git worktree add ../MyRoboView-lyos-reference Master
# 比较原始构建或接口
git show Master:CMakeLists.txt
git show Master:backend/include/api_handlers.h
```

后续每个能力独立提交：先定义消息/配置与验收，再迁移表现层或适配代码，最后添加真实消息回归。不要整目录复制旧 API、产品宏、硬编码文件路径和业务消息依赖。

## Git 约定

- 保留大小写准确的 `Master`，作为原始快照和默认分支。
- 开发、方案和本次裁剪提交到 `develop`，设置 `origin/develop` 跟踪。
- 后续按 ROS2/ROADMAP.md 阶段拆分提交；不向 Master 合并日常开发。
- 用户要求的是源码基线，未配置生产部署，也未变更原 RoboView 工作区。
