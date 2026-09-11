# 实现概要
## 后端（src/roboview/backend/）
- auth_service.h / auth_service.cpp：从 JSON 加载 jwt_secret 与三条固定用户；密码校验 PBKDF2-HMAC-SHA256（pbkdf2-sha256$迭代$salt_hex$hash_hex）；签发/校验 HS256 JWT（12 小时）；roleRank / roleAtLeast。
- api_handlers.h / api_handlers.cpp：新增 POST /api/v1/auth/login、GET /api/v1/auth/me、OPTIONS /api/v1/auth/login；除登录与各类 OPTIONS 外，所有原有 API 均需 Authorization: Bearer；/api/v1/motor/calibrate 仅 admin。
- main.cpp：启动时加载认证文件（ROBOT_MONITOR_AUTH_CONFIG 或 <cwd>/config/auth_users.json），失败则 直接退出。
- websocket_handler.cpp：握手查询参数 token 必须为合法 JWT，否则 forceClose() 且不加入连接表。
- CMakeLists.txt：加入 auth_service.cpp，find_package(OpenSSL REQUIRED)，链接 OpenSSL::Crypto；安装 auth_users.json  到 etc/web_config/。
- 配置与工具：config/auth_users.example.json、config/auth_users.json（开发用）、config/.gitignore（忽略现场 auth_users.json）、config/AUTH_MAINTENANCE.md、tools/gen_roboview_password.py。
- README.md：补充 OpenSSL 与认证说明链接。

## 前端（src/roboview/my-app/）
- index.js：BrowserRouter + AuthProvider。
- context/AuthContext.js：登录、/auth/me 恢复会话、logout、isAdmin；登录请求使用 apiUrl('/api/v1/auth/login') 以兼容 REACT_APP_API_URL。
- utils/apiClient.js：sessionStorage 存 JWT、apiFetch（自动带 Bearer、401 清 token 并派发事件）、getWebSocketUrlWithAuth()（?token=）。
- components/pages/Login.js + Login.css：领益机器人 / RoboView 登录页。
- components/ProtectedRoute.js：未登录跳转 /login。
- App.js：MainApp 保留原逻辑；外层 /login 与 /* + ProtectedRoute；WebSocket 使用 getWebSocketUrlWithAuth；关节标定仅 showMotorCalibrate={isAdmin}。
- JointControl.js：仅管理员显示「关节标定」按钮；标定请求走 apiFetch。
- RobotControl / SensorData / LogDownload / SystemInfo：HTTP 改为 apiFetch。
- Sidebar.js：显示用户名、角色中文、退出登录。

# RoboView 认证配置维护说明

## 概述

- 账号与口令哈希写在 JSON 配置中（默认路径：与可执行文件工作目录下的 `config/auth_users.json`，或通过环境变量 `ROBOT_MONITOR_AUTH_CONFIG` 指定绝对路径）。
- 密码使用 **PBKDF2-HMAC-SHA256**（100000 次迭代），配置里只存哈希，不存明文。
- 登录成功后颁发 **JWT（HS256）**，HTTP 请求头携带 `Authorization: Bearer <token>`；WebSocket 连接 URL 需带查询参数 `token=<jwt>`。

## 默认示例账号（与仓库内 `auth_users.json` / `auth_users.example.json` 对应）

| 登录名     | 角色        | 默认密码   | 说明 |
|------------|-------------|------------|------|
| admin      | admin       | admin123   | 最高权限；关节标定等敏感操作仅该角色可用 |
| developer  | developer   | dev123     | 开发者 |
| user   | user        | ly@robot    | 普通用户 |

**生产环境务必**修改 `jwt_secret` 与全部 `password_pbkdf2`，并限制 `auth_users.json` 文件权限（仅运行用户可读）。

## 修改密码

1. 使用仓库脚本生成新的 `password_pbkdf2` 字段值：

   ```bash
   python3 src/roboview/backend/tools/gen_roboview_password.py
   ```

   按提示输入新明文密码，终端会输出一行：

   `pbkdf2-sha256$100000$<salt_hex>$<hash_hex>`

2. 编辑 `config/auth_users.json`，将对应用户条目的 `password_pbkdf2` 替换为上述整行字符串。

3. 重启 `roboview` 后端进程使配置生效。

也可用一行 Python（将 `新密码` 改为目标明文）：

```bash
python3 -c "import hashlib,secrets;it=100000;s=secrets.token_bytes(16);p=b'新密码';d=hashlib.pbkdf2_hmac('sha256',p,s,it);print('pbkdf2-sha256$'+str(it)+'$'+s.hex()+'$'+d.hex())"
```

## 修改登录名（用户名）

1. 编辑 `config/auth_users.json` 中对应对象的 `username` 字段（保持唯一）。
2. `role` 必须为以下之一：`admin`、`developer`、`user`。
3. 重启后端。

注意：修改用户名后，旧 JWT 中的 `sub` 与旧名不一致时，旧令牌在过期前仍可能有效（直至 `exp`）；重要场景可缩短 JWT 有效期或重启后让用户重新登录。

## 修改 jwt_secret

编辑 JSON 顶层 `jwt_secret`：**长度至少 32 字符**。修改后所有已签发的 JWT 立即失效，用户需重新登录。

## 环境变量：`ROBOT_MONITOR_AUTH_CONFIG` 是什么？

`ROBOT_MONITOR_AUTH_CONFIG` 是一个**操作系统环境变量**，值为 **`auth_users.json` 文件的绝对路径**（例如 `/app/etc/roboview/config/auth_users.json`）。

- **设置了**：后端只从该路径加载认证配置，**不再**依赖「当前工作目录下的 `config/auth_users.json`」。
- **未设置**：后端使用 **`<进程启动时的当前工作目录>/config/auth_users.json`**。在 NX 上若由 systemd 启动、`WorkingDirectory` 不是你以为的目录，很容易找不到文件，**生产环境强烈建议始终设置本变量**。

## NX / 编译安装后文件放在哪里？和 `etc/web/` 的关系

`CMakeLists.txt` 里：

- **`etc/web/`**：只安装**前端静态资源**（`my-app/build/`），给浏览器访问页面用。
- **`etc/web_config/`**：安装认证配置文件 **`auth_users.json`** 。

**登录/账号配置只给后端 `roboview` 进程读**，应放在 **`etc/roboview/config/`**（或你自定义的仅后端可读目录），**不要**放进 `etc/web/`：

- `etc/web/` 往往由 HTTP 服务器直接对外提供静态文件，把含密码哈希的配置放在同目录会增加误暴露风险，且与职责划分不符（前端构建产物 vs 后端密钥材料）。

在机器上的典型布局（`<prefix>` 为 ROS/ament 安装前缀，例如 `install` 或镜像里的 `/opt/ros/...`）：

| 路径（相对安装前缀） | 内容 |
|----------------------|------|
| `bin/roboview` | 后端可执行文件 |
| `etc/web/` | 前端静态文件 |
| `etc/web_config/auth_users.json` | **需你在设备上生成/拷贝**（含真实 `jwt_secret` 与哈希），仓库默认 `.gitignore` 忽略现场文件 |

### NX 上推荐怎么设置

1. 在目标机上把模板拷成正式配置（路径按你的 `<prefix>` 修改）：

   ```bash
   cp <prefix>/etc/roboview/config/auth_users.example.json \
      <prefix>/etc/roboview/config/auth_users.json
   ```

   编辑 `auth_users.json`：改 `jwt_secret`、各用户 `password_pbkdf2`（见上文「修改密码」）。

2. 启动 `roboview` 时设置环境变量（**systemd** 示例）：

   ```ini
   [Service]
   Environment="ROBOT_MONITOR_AUTH_CONFIG=<prefix>/etc/roboview/config/auth_users.json"
   WorkingDirectory=<prefix>   # 可选；不依赖 cwd 找配置时以环境变量为准
   ```

若你们镜像里统一把配置放在 **`/app/etc`**（与后端里 `DEFAULT_ROBOTETC_PATH` 等约定一致），也可以固定为：

```ini
Environment="ROBOT_MONITOR_AUTH_CONFIG=/app/etc/roboview/config/auth_users.json"
```

只要把该路径上的 `auth_users.json` 部署好即可。

## 部署清单

1. 将 `auth_users.example.json` 复制为 `auth_users.json`（或直接使用仓库内开发用 `auth_users.json` 后替换密钥）。
2. **NX/生产**：设置 `ROBOT_MONITOR_AUTH_CONFIG` 指向上述 `auth_users.json` 的绝对路径；不要依赖「碰巧 cwd 下有 `config/`」。
3. 前端与 WebSocket 使用同一 JWT；无 token 或校验失败时 WebSocket 会被立即断开。

## 角色与前端能力（摘要）

- **admin**：可使用关节标定等管理员功能；后端 `/api/v1/motor/calibrate` 仅允许该角色。
- **developer** / **user**：可登录并使用除标定外的已保护 API；具体菜单显隐由前端按角色控制，**以后端鉴权为准**。
