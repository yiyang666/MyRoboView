# roboview — 前后端一体包与开发/生产构建体系（Demo 2.0）

本目录是一个 colcon 包，**目录名、包名、二进制名统一为 `roboview`**，
**包根就在本目录**（`CMakeLists.txt` + `package.xml`），
前后端同级组织，保证"一次构建 = 前后端产物对齐"：

```
roboview/
├── CMakeLists.txt / package.xml   # colcon 包定义（包根，统一编排前后端安装规则）
├── backend/                       # Drogon C++ 后端
│   ├── src/ include/              #   服务入口、REST API、WebSocket、ROS 订阅
│   ├── config/ assets/            #   运行配置、导航数据、地图
│   └── test/                      #   核心单元测试；系统集成测试位于仓根 integration_tests/
└── frontend/                      # React 前端（Vite 6 构建）
    ├── index.html                 #   Vite 入口页（位于包根；%REACT_APP_PRODUCT% 构建期替换）
    ├── vite.config.js             #   唯一构建配置：dev 代理 / 产品注入 / 产物布局
    ├── src/ public/               #   源码（含 JSX 的文件用 .jsx 后缀）与静态资源
    ├── asserts/<产品>/robot_urdf/ #   按产品划分的 URDF 资源（前后端对齐的关键，gitignore）
    └── build/<产品>/              #   生产产物（gitignore，按产品分目录防互相覆盖）
```

## 开发态（日常调试，仅 x86_64， 默认产品lrs-x）

```bash
./scripts/run_robotapp.sh   # 终端1：单独启动 robotapp mock（数据源）
./scripts/start_dev.sh      # 终端2：前端 dev server(:3000) + 后端(:8080)
```

`start_dev.sh` 做三件事：

1. 把 `frontend/asserts/<产品>/robot_urdf` 同步到 `frontend/public/assets/robot_urdf`（与生产 URL `/assets/robot_urdf` 对齐；gitignore）
2. 后台启动 Vite dev server（按需编译，**不产生磁盘产物**）
3. 前台启动后端 `roboview`

前后端关联：`frontend/vite.config.js` 的 `server.proxy` 把 `/api`、`/api/v1/telemetry`(WS)、
`/nav_maps` 代理到 `127.0.0.1:8080`，浏览器访问 **:3000** 即可联调。
dev server 仅监听回环地址，且对非本机 Host 头返回 403（防 DNS 重绑定），故仅本机可访问。

## 前端构建体系（Vite）

### 工具链版本

| 项 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | ^18 / ^20 / >=22 | `package.json` engines 约束 |
| Vite | ^6 | dev server + 生产构建（esbuild 编译，全量构建 <1s） |
| @vitejs/plugin-react | ^4 | JSX 转换与 Fast Refresh |

npm 脚本（`frontend/package.json`）：

| 命令 | 用途 |
| --- | --- |
| `npm start` / `npm run dev` | 启动 dev server（:3000，通常由 `start_dev.sh` 调用，不手工执行） |
| `npm run build` | 生产构建到 `build/<产品>/`（产品由 `REACT_APP_PRODUCT` 决定） |
| `npm run preview` | 本地预览构建产物（不含后端代理，仅排查静态页用） |

### 产品注入链路（REACT_APP_PRODUCT）

产品标识全链路同名：外层 `Makefile PRODUCT` → `AI_TARGET_PRODUCT`（后端 CMake）
→ `REACT_APP_PRODUCT`（前端）。保留 `REACT_APP_` 历史前缀仅为接口稳定，与 CRA 无关。

- **注入**：CMake 构建层与 `start_dev.sh` 都导出 `REACT_APP_PRODUCT=<产品>`；
  `vite.config.js` 用 `envPrefix: 'REACT_APP_'` 把它暴露给源码，并据此决定输出目录；
- **源码读取**：`import.meta.env.REACT_APP_PRODUCT` —— 浏览器侧没有 `process.env`，
  Vite 在构建期做**静态替换**（见 `src/config/robotUrdfConfig.js`，按产品选中关节映射等差异化配置）；
- **入口页**：`index.html` 中 `%REACT_APP_PRODUCT%` 同样被替换（产物 meta 标签，便于溯源）；
- 未设置时默认 `lrs-x`（与 CMake 默认值一致）。

### 产物布局与安装映射

```
build/<产品>/
├── index.html                      # 入口页（含产品 meta）
├── static/                         # assetsDir：哈希 js/css
└── favicon.ico / manifest.json / assets/robot_urdf/ ...   # public/ 原样拷贝（安装时排除 robot_urdf）
```

`assetsDir: 'static'` 让 hash 资源落在 `etc/web/static/`，与 `etc/web/assets/`（URDF、地图）分区。
安装前会**整目录清空 `etc/web`** 再按原顺序装入地图 → 前端产物 → asserts，避免 CRA 旧布局 / 异产品资源残留。
`build/<产品>/` 里可能含开发态同步的 `assets/robot_urdf/`（产品不确定），
安装时按 `PATTERN "robot_urdf" EXCLUDE` 排除，再由 `asserts/${AI_TARGET_PRODUCT}/` 补装正确产品的资源。

### CMake 编排（正常构建无需手工 npm）

`colcon build`（或外层 `make <产品>_<平台>`）时自动完成：

1. **依赖层**：`frontend/package.json` 或 `package-lock.json` 变化 → `npm ci`（严格按锁安装）；
   stamp 记录在构建目录，不污染源码树；
2. **构建层**：`src/`、`public/`、`index.html`、`vite.config.js` 任一变化 →
   `REACT_APP_PRODUCT=<产品> npm run build`；CI 全新工作区必然全量构建。

构建机需具备 node/npm（新机器可跑外层 `make install_all_dependencies`）。

### 手工构建（仅调试时需要）

```bash
cd roboview/frontend
npm ci                                    # 严格按锁装依赖
REACT_APP_PRODUCT=lrd-w npm run build     # 产出 build/lrd-w/
```

### 与 CRA 时代的行为差异（2026-09 迁移注意项）

- **ESLint 不再随构建执行**（Vite 不做规范/类型检查），源码质量走编辑器与评审把关；
- **无前端单元测试**：原 CRA 内置的 Jest 从未使用，已连同 `@testing-library/*` 移除；
  需要时引入 Vitest（jsdom 环境 + `@testing-library/react`）；
- **未使用依赖已移除**：`three`、`@react-three/fiber`、`@react-three/drei`、
  `three-mesh-bvh`、`urdf-loader`（源码仅做关节名映射、未挂载 3D viewer）、
  `react-router-dom`（页面为状态切换、无路由）、`web-vitals`、`http-proxy-middleware`
  （代理已由 vite.config.js 内建）。恢复 3D 展示或路由时按需加回；
- JSX 文件必须使用 `.jsx` 后缀（Vite 约定，`.js` 不再按 JSX 解析）。

## 生产态（安装包 / 部署）

```
frontend/  --npm ci + npm run build-->  frontend/build/<产品>/  --┐
           （CMake 随 colcon build 自动编排）                     ├--CMake 安装规则-->  install/etc/web/
asserts/${AI_TARGET_PRODUCT}/  --------------------------------┘   （页面 + 当前产品的 robot_urdf）
backend/   --colcon build-->   install/bin/roboview
                               install/etc/web_config/  （当前产品的配置 + 导航数据）
```

关键规则（见 `CMakeLists.txt` install 段）：

- 后端配置按产品拆分在 `backend/config/<产品>/`，**只安装当前产品那一份**
  （configure 期校验存在性，缺失直接报错）；
- 前端产物 `frontend/build/` 安装时**排除 `robot_urdf`**，再由 `asserts/${AI_TARGET_PRODUCT}/`
  补入——无论构建时 `public/` 里放的是哪个产品的资源，**装进包的 URDF 一定与构建产品一致**；
- `AI_TARGET_PRODUCT` 由外层统一构建体系按产品传入（仓内直编时默认 `lrs-x`），
  同时以 `REACT_APP_PRODUCT` 注入前端构建；开发态由 `start_dev.sh` 同源注入；
- 部署时后端直接托管页面：`main.cpp` 将 Drogon 的 document root 设为 `<安装前缀>/etc/web`，
  浏览器访问 **:8080** 即是完整系统（无需单独前端服务器）。

## 构建与测试入口

| 场景 | 命令 | 产物位置 |
| --- | --- | --- |
| 开发（外层统一构建体系） | `./scripts/build.sh [-p 产品]` | `build_all_robot/build/<产品>/x86_64/install/` |
| CI / 无外层体系 | `./scripts/build.sh --local` | 本仓 `install/` |
| 测试 | `./scripts/test.sh [--local]` | 跟随构建模式 |

外层体系的源码由 `make vcs_<产品>_<平台>` 以 git clone 形式拉取到 `build_all_robot/src/` 下，
日常开发直接在该工作区进行（`.clang-format` 向上查找天然命中体系根部的配置）。

CI（`.github/workflows/ros2.yml`）的职责是验证**单仓可编译、测试可通过**，
因此使用 `--local` 仓内独立构建，不依赖外层统一构建体系。
