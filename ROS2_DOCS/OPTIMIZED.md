# 当前项目问题

维护日期：2026-09-17；基线：**Demo 2.0**（Vite 6 前端重构 + 安装/认证评审修复）。P0 为阻断/数据丢失，P1 为关键路径错误，P2 为局部缺陷，P3 为低影响问题。

| ID | 优先级 | 模块 | 问题与触发条件 | 评审时间 / 版本 | 状态与验收条件 |
|---|---|---|---|---|---|
| BUG-01 | P2 | 前端构建 | 开发态 `public/assets/robot_urdf` 仍会被 Vite 原样复制进另一产品的原始 build；最终安装虽排除该目录并重装当前产品资源，但源码构建产物仍可能受污染 | 2026-09-15 / Demo 1.0 | 隔离开发资源，使原始双产品 build 不再包含异产品 URDF |
| BUG-02 | P2 | npm 缓存 | 独立产品 stamp 共用 node_modules，并发首次构建可能互相 npm ci；删除 node_modules 后 stamp 仍存在 | 2026-09-15 / Demo 1.0 | 当前串行构建，暂不处理；若外层并行构建再加依赖目录校验/互斥或独立工作目录 |
| BUG-03 | P2 | 身份处理 | 同名 DDS 话题上的异产品/个体消息未在运行时拒绝；测试验证的是正确组合 | 2026-09-15 / Demo 1.0 | 增加运行时告警/隔离及负例；MotorHealth 本身没有身份字段 |

## 当前项目可优化

| ID | 优先级 | 模块 | 建议与价值 | 评审时间 / 版本 |
|---|---|---|---|---|
| OPT-01 | P2 | 发布 | repos 锁定 commit，记录两个仓库与依赖版本；当前 develop 会移动 | 2026-09-14 / Demo 0.3 |
| OPT-02 | P2 | 测试 | 浏览器交互 E2E；HTTP 静态文件检查不能证明 React 渲染和按钮交互 | 2026-09-15 / Demo 1.0 |
| OPT-03 | P2 | 发布 | 干净 staging 打包；URDF 大文件来源与校验和管理，CI 无资源时明确跳过检查 | 2026-09-15 / Demo 1.0 |
| OPT-04 | P2 | NX | sysroot 补齐 ROS2 aarch64 后再开放交叉编译；实机验证后才标记部署完成 | 2026-09-14 / Demo 0.3 |
| OPT-05 | P3 | 启动 | run_demo.sh 支持产品参数，各脚本统一白名单与路径解析 | 2026-09-14 / Demo 0.3 |
| OPT-06 | P3 | 契约 | 从消息定义生成前端枚举；有旧实机混跑需求时再实现独立契约适配器 | 2026-09-15 / Demo 1.0 |
| OPT-07 | P2 | CI | 外层仓增加系统构建流水线；业务仓双产品 --local 不代表验证外层 Makefile | 2026-09-15 / Demo 1.0 |
| OPT-08 | P2 | 前端质量 | Vite 构建不再附带 CRA 的 ESLint/Jest；增加独立 `lint` 与最小 Vitest，作为构建之外的 CI 门禁 | 2026-09-16 / Demo 1.0 |
| OPT-09 | P3 | 安装声明 | 配置和地图使用 glob 安装，新增同后缀文件会被静默带入发布包；关键发布文件宜显式列举并逐项报错 | 2026-09-16 / Demo 1.0 |

## 已解决的历史评审问题

| ID | 模块 | 问题 | 解决方法与证据 | 评审 / 解决阶段 |
|---|---|---|---|---|
| DONE-01 | 工作区 | rsync 副本失去源码身份 | src/myroboview 内直接开发独立 Git 工作树，删除覆盖同步 | 09-14 / 09-15 上午 |
| DONE-02 | 构建管理 | 外层体系未版本化 | build_all_robot 独立 Git 仓库 | 09-14 / 09-15 上午 |
| DONE-03 | 产品 | 通用配置与资源无法一起选择 | MOCK、后端按产品安装，前端 REACT_APP_PRODUCT 选择映射 | 09-15 / Demo 1.0 |
| DONE-04 | 构建 | 缺前端时仍安装占位页 | CMake frontend_build ALL，依赖 npm ci 和打包，删除占位页 | 09-15 / Demo 1.0 |
| DONE-05 | 前端 | 双产品交替覆盖产物 | BUILD_PATH=build/<产品> | 09-15 / Demo 1.0 |
| DONE-06 | 启动 | 广泛按名字或端口终止进程 | PID 文件、/proc 身份验证；端口冲突报错 | 09-15 / Demo 1.0 |
| DONE-07 | MOCK | 产品差异不足 | 26/16 电机、WAVE/RUN 动作、身份与健康等级 | 09-15 / Demo 1.0 |
| DONE-08 | 契约 | 不兼容字段变更未记录版本 | node_app_msgs 0.3.0 / ROS v2，[迁移说明](CONTRACTS.md)明确整体升级和回滚 | 09-15 / 本轮 |
| DONE-09 | 测试目录 | 跨组件测试归属 backend | integration_tests 移至仓根，脚本及文档同步 | 09-15 / 本轮 |
| DONE-10 | 测试覆盖 | 缺产品身份、安装检查、持久报告 | 配置/消息身份、静态集合与 HTTP 内容断言；JUnit、元数据、阶段日志与 CI always 归档 | 09-15 / 本轮 |
| DONE-11 | 安装 | 旧 hash 文件积累 | 仅替换生成的 static 目录；文件集合和内容校验，保留编译缓存 | 09-15 / 本轮 |
| DONE-12 | 文档 | README 数量、路径和结构过期 | 背景、双产品表、架构与时序、启动、报告、链接全部整理 | 09-15 / 本轮 |
| DONE-13 | 前端工具链 | CRA 依赖重、构建慢且代理分散 | 迁移到 Vite 6，入口与 JSX 后缀规范化，代理、产品注入和按产品输出收敛到 `vite.config.js`；锁文件和未使用依赖显著精简 | 09-16 / Demo 1.0 |
| DONE-14 | 安装布局 | 地图、URDF 与前端 hash 产物边界不清 | 地图收敛到 `etc/web/assets/maps`，当前产品 URDF 收敛到 `etc/web/assets/robot_urdf`，Vite hash 资源独占 `etc/web/static` | 09-16 / Demo 1.0 |
| DONE-15 | 构建 / CI | auth JSON 被 ignore 却为构建必需 | 取消对 `config/auth/` 目录的 ignore；入库 `auth_users.example.json`（真实 `auth_users.json` 仍 ignore）；CMake 校验并正常安装 example；登录未启用、后端暂不引用 | 09-16 / 本轮 |
| DONE-16 | 安装 / 产品隔离 | 增量安装只清 `static`，旧布局与异产品资源残留 | 安装前整目录清空 `etc/web`，再按原顺序安装地图 → 前端产物 → asserts；暂不扩展升级安装 allowlist 测试 | 09-16 / 本轮 |
| DONE-17 | 前端资源契约 | URDF 配置 URL 与生产路径不一致 | 两产品 `robotUrdfConfig` 与 `start_dev.sh` 同步路径统一为 `/assets/robot_urdf/`；当前仍未挂载 3D viewer | 09-16 / 本轮 |

新增问题先进入前两节；验收通过后移入历史表，保留 ID、方法及验证证据。
提交时间与二进制 mtime 不能单独证明产物过期；应结合增量构建、完整安装清单、文件比对与测试报告判断。
