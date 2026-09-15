# roboview — 前后端一体包与开发/生产构建体系

本目录是一个 colcon 包，**目录名、包名、二进制名统一为 `roboview`**，
**包根就在本目录**（`CMakeLists.txt` + `package.xml`），
前后端同级组织，保证"一次构建 = 前后端产物对齐"：

```
roboview/
├── CMakeLists.txt / package.xml   # colcon 包定义（包根，统一编排前后端安装规则）
├── backend/                       # Drogon C++ 后端
│   ├── src/ include/              #   服务入口、REST API、WebSocket、ROS 订阅
│   ├── config/ assets/            #   运行配置、导航数据、地图
│   └── test/                     #   核心单元测试；系统集成测试位于仓根 integration_tests/
└── frontend/                      # React 前端（CRA）
    ├── src/ public/               #   源码与静态资源
    ├── asserts/<产品>/robot_urdf/ #   按产品划分的 URDF 资源（前后端对齐的关键）
    └── build/<产品>/              #   npm 生产产物（gitignore，按产品分目录防互相覆盖）
```

## 开发态（日常调试，仅 x86_64）

```bash
./scripts/run_robotapp.sh   # 终端1：单独启动 robotapp mock（数据源）
./scripts/start_dev.sh      # 终端2：前端 dev server(:3000) + 后端(:8080)
```

`start_dev.sh` 做三件事：

1. 把 `frontend/asserts/<产品>/robot_urdf` 同步到 `frontend/public/robot_urdf`（CRA 静态托管，gitignore）
2. 后台启动 CRA dev server（webpack 内存编译，**不产生磁盘产物**）
3. 前台启动后端 `roboview`

前后端关联：`frontend/src/setupProxy.js` 把 `/api`、`/api/v1/telemetry`(WS)、`/nav_maps`
代理到 `127.0.0.1:8080`，浏览器访问 **:3000** 即可联调。

## 生产态（安装包 / 部署）

```
frontend/  --npm ci + npm run build-->  frontend/build/<产品>/  --┐
           （CMake 随 colcon build 自动编排）                     ├--CMake 安装规则-->  install/etc/web/
asserts/${AI_TARGET_PRODUCT}/  --------------------------------┘   （页面 + 当前产品的 robot_urdf）
backend/   --colcon build-->   install/bin/roboview
                               install/etc/web_config/  （当前产品的配置 + 导航数据）
```

关键规则（见 `CMakeLists.txt` install 段）：

- 后端配置按产品拆分在 `backend/config/<产品>/myroboview.json`，**只安装当前产品那一份**
  （configure 期校验存在性，缺失直接报错）；
- 前端产物 `frontend/build/` 安装时**排除 `robot_urdf`**，再由 `asserts/${AI_TARGET_PRODUCT}/`
  补入——无论前端 build 时 `public/` 里放的是哪个产品的资源，**装进包的 URDF 一定与构建产品一致**；
- `AI_TARGET_PRODUCT` 由外层统一构建体系按产品传入（仓内直编时默认 `lrs-x`），
  同时以 `REACT_APP_PRODUCT` 注入前端构建——`frontend/src/config/robotUrdfConfig.js`
  在编译期选中对应产品配置（电机状态卡片等差异化显示）；开发态由 `start_dev.sh` 同源注入；
- 前端构建由 CMake 随 `colcon build` 自动编排：`package-lock.json` 变化才 `npm ci`（严格按锁安装），
  前端源码变化才 `npm run build`，CI 全新工作区必然全量构建——无需手工执行 npm 命令；
  构建机需具备 node/npm（新机器可跑外层 `make install_all_dependencies`）；
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
