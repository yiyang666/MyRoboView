# 机器人系统监控 Web 应用

一个基于 React + Three.js 前端和 C++ (Drogon) 后端的机器人系统状态监控和控制系统。

## 🏠 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                     用户浏览器                           │
│  ┌──────────────────────────────────────────────────┐  │
│  │         React 前端应用 (Port 3000)                │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │  │
│  │  │ 菜单栏   │  │ 状态栏   │  │  3D展示区     │   │  │
│  │  └──────────┘  └──────────┘  └──────────────┘   │  │
│  │  ┌────────────────────────────────────────────┐  │  │
│  │  │           功能区（动态切换）                │  │  │
│  │  └────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                        │
                        │ HTTP / WebSocket
                        │
┌─────────────────────────────────────────────────────────┐
│                    Nginx (Port 80)                      │
│  ┌──────────────────┐  ┌──────────────────────────┐    │
│  │  静态文件服务     │  │   反向代理               │    │
│  │  (React Build)   │  │  /api/* → C++ Backend   │    │
│  │                  │  │  /ws → C++ WebSocket    │    │
│  └──────────────────┘  └──────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
                        │
                        │
┌─────────────────────────────────────────────────────────┐
│          C++ 后端服务 (Drogon, Port 8080)               │
│  ┌──────────────────┐  ┌──────────────────────────┐    │
│  │   REST API       │  │   WebSocket Server       │    │
│  │   - /api/v1/*    │  │   - /ws                  │    │
│  └──────────────────┘  └──────────────────────────┘    │
│  ┌──────────────────────────────────────────────────┐  │
│  │           机器人状态管理 (线程安全)                │  │
│  │   - 状态更新                                       │  │
│  │   - 命令处理                                       │  │
│  │   - 多客户端广播                                   │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## 📋 目录结构

```
roboview/
├── my-app/                 # React 前端应用
│   ├── src/
│   │   ├── components/     # React 组件
│   │   │   ├── Sidebar.js      # 左侧菜单栏
│   │   │   ├── StatusBar.js    # 顶部状态栏
│   │   │   ├── Robot3DView.js  # 3D 机器人展示
│   │   │   └── pages/          # 功能页面
│   │   │       ├── SensorData.js    # 传感器数据
│   │   │       ├── RobotControl.js  # 机器人控制
│   │   │       ├── LogViewer.js     # 日志查看
│   │   │       └── SystemInfo.js    # 系统信息
│   │   ├── hooks/
│   │   │   └── useWebSocket.js  # WebSocket Hook
│   │   └── App.js
│   └── package.json
├── backend/                # C++ 后端服务 (Drogon)
│   ├── CMakeLists.txt     # CMake 构建配置
│   ├── Makefile           # 构建脚本
│   ├── include/           # 头文件
│   └── src/               # 源文件
├── nginx/                  # Nginx 配置
│   └── nginx.conf         # Nginx 配置文件
└── README.md              # 本文档
```

## 🚀 快速开始

### 前置条件检查

```bash
# 检查 Node.js
node --version  # 需要 >= 16.0.0

# 检查 CMake
cmake --version  # 需要 >= 3.15

# 检查 npm
npm --version  # 需要 >= 8.0.0

# 检查 Drogon（可选，如果未安装会提示）
ls /usr/local/lib/libdrogon* 2>/dev/null || echo "需要安装 Drogon"
```

### 一键启动（开发模式）

```bash
cd roboview
./start_dev.sh -p lrd-w # 仅本机可登陆
./start_dev.sh -p lrs-x --lan #局域网可登陆
```

这个脚本会自动：
1. 检查环境
2. 构建后端（如果需要）
3. 启动后端服务（端口 8080）
4. 启动前端服务（端口 3000）

### 手动启动

#### 1. 安装依赖

**前端依赖:**
```bash
cd roboview/my-app
npm install
```

**后端依赖（Drogon 框架）:**

详细安装说明请查看:
[Drogon 官方文档](https://github.com/drogonframework/drogon/wiki/Installation)
[Drogon 快速安装](./backend/INSTALL_DROGON.md)

#### 2. 启动服务

**启动后端:**
```bash
cd roboview/backend
make build  # 首次运行需要构建
make run    # 或直接运行 ./build/robot-monitor-backend
```

**启动前端（新终端）:**
```bash
cd roboview/my-app
npm start
```

### 访问应用

打开浏览器访问：`http://localhost:3000`

---

## 📖 详细文档

### 环境要求

- **Node.js**: >= 16.0.0
- **npm**: >= 8.0.0
- **C++17 编译器**: GCC 7+ 或 Clang 5+
- **CMake**: >= 3.15
- **Drogon 框架**: 详见 [安装说明](backend/INSTALL_DROGON.md) 或 [官方文档](https://github.com/drogonframework/drogon/wiki/Installation)

### 常见问题

**端口被占用:**
```bash
# 查找占用进程
lsof -i :8080  # 后端
lsof -i :3000  # 前端
# 结束进程
kill -9 <PID>
```

**Drogon 未找到:**
- 查看 [Drogon 安装说明](backend/INSTALL_DROGON.md)
- 或参考 [Drogon 官方安装文档](https://github.com/drogonframework/drogon/wiki/Installation)

**npm 安装慢:**
```bash
npm config set registry https://registry.npmmirror.com
```

---

## 📖 详细文档

### 后端文档
- [后端 README](backend/README.md) - 后端 API 和使用说明
- [Drogon 安装指南](backend/INSTALL_DROGON.md) - 快速安装参考（详细文档请查看官方）

### 架构文档
- [系统架构](ARCHITECTURE.md) - 系统架构说明

### 生产部署

**1. 构建前端**

```bash
cd roboview/my-app
npm run build
```

构建完成后，静态文件将生成在 `build/` 目录。

**2. 构建后端**

```bash
cd roboview/backend
make build
```

**3. 配置 Nginx**

```bash
# 复制 Nginx 配置
sudo cp roboview/nginx/nginx.conf /etc/nginx/sites-available/robot-monitor

# 创建符号链接
sudo ln -s /etc/nginx/sites-available/robot-monitor /etc/nginx/sites-enabled/

# 创建静态文件目录
sudo mkdir -p /var/www/robot-monitor

# 复制前端构建文件
sudo cp -r roboview/my-app/build/* /var/www/robot-monitor/

# 测试 Nginx 配置
sudo nginx -t

# 重启 Nginx
sudo systemctl restart nginx
```

**4. 启动后端服务**

```bash
cd roboview/backend
./build/robot_monitor_backend
```

或者使用 systemd 服务（创建 `/etc/systemd/system/robot-monitor.service`）：

```ini
[Unit]
Description=Robot Monitor Backend
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/roboview/backend
ExecStart=/path/to/roboview/backend/build/robot-monitor-backend
Restart=always

[Install]
WantedBy=multi-user.target
```

然后启动服务：

```bash
sudo systemctl enable robot-monitor
sudo systemctl start robot-monitor
```

**5. 访问应用**

打开浏览器访问：`http://localhost`（或配置的域名）

## 📖 功能说明

### 前端功能

1. **左侧菜单栏**
   - 传感器数据：查看 IMU、环境传感器等数据
   - 机器人控制：发送控制命令、设置关节角度
   - 日志查看：实时查看系统日志
   - 系统信息：查看系统版本、CPU、内存、磁盘使用情况

2. **顶部状态栏**
   - WebSocket 连接状态
   - 机器人运行状态
   - 电池电量和电压
   - 当前模式

3. **3D 机器人展示区（上半区）**
   - 实时显示 3D 机器人模型
   - 支持鼠标交互（旋转、缩放、平移）
   - 点击关节进行控制
   - 实时更新关节角度

4. **功能区（下半区）**
   - 根据菜单选择动态切换不同功能页面
   - 支持路由导航

### 后端功能

1. **REST API**
   - `GET /api/v1/status` - 获取机器人状态
   - `POST /api/v1/control/start` - 启动机器人
   - `POST /api/v1/control/stop` - 停止机器人
   - `POST /api/v1/control/reset` - 重置机器人
   - `POST /api/v1/control/joint` - 设置关节角度

2. **WebSocket 服务**
   - `ws://localhost:8080/ws` - WebSocket 连接端点
   - 实时推送机器人状态更新
   - 接收前端控制命令

## 🔧 开发指南

### 添加新的功能页面

1. 在 `my-app/src/components/pages/` 创建新组件
2. 在 `my-app/src/App.js` 中添加路由
3. 在 `my-app/src/components/Sidebar.js` 中添加菜单项

### 添加新的 API 接口

在 `backend/src/api_handlers.cpp` 中添加新的处理函数，并在 `backend/include/api_handlers.h` 中注册路由：

```cpp
// 在 api_handlers.h 中
ADD_METHOD_TO(ApiController::newHandler, "/api/v1/control/new-endpoint", Post);

// 在 api_handlers.cpp 中实现
void ApiController::newHandler(const HttpRequestPtr& req,
                               std::function<void(const HttpResponsePtr&)>&& callback) {
    // 处理逻辑
}
```

### 自定义 3D 模型

1. 准备 GLB 或 GLTF 格式的机器人模型文件
2. 在 `Robot3DView.js` 中使用 `useGLTF` Hook 加载模型：

```javascript
import { useGLTF } from '@react-three/drei';

function RobotModel() {
  const { scene } = useGLTF('/path/to/robot.glb');
  return <primitive object={scene} />;
}
```

## 🐛 故障排除

详细故障排除请参考：
- [后端 README](backend/README.md#故障排除) - 后端相关问题
- [Drogon 安装指南](backend/INSTALL_DROGON.md#常见问题) - 安装相关问题

## 📝 API 文档

### WebSocket 消息格式

#### 客户端发送消息

```json
{
  "type": "command",
  "command_type": "start",
  "data": {},
  "timestamp": 1234567890
}
```

#### 服务器推送消息

```json
{
  "type": "robot_state",
  "data": {
    "battery": 100,
    "voltage": 24.0,
    "status": "running",
    "mode": "normal",
    "joints": [
      {"id": "joint1", "name": "关节1", "angle": 45.0}
    ]
  },
  "timestamp": 1234567890
}
```

### REST API 示例

**获取状态:**
```bash
curl http://localhost:8080/api/v1/status
```

**启动机器人:**
```bash
curl -X POST http://localhost:8080/api/v1/control/start
```

**设置关节角度:**
```bash
curl -X POST http://localhost:8080/api/v1/control/joint \
  -H "Content-Type: application/json" \
  -d '{"joint_id": "joint1", "angle": 45.0}'
```

## 🔒 安全建议

1. **生产环境配置 HTTPS**
   - 使用 Let's Encrypt 获取免费 SSL 证书
   - 配置 Nginx SSL 设置

2. **API 认证**
   - 添加 JWT 或 API Key 认证
   - 限制 WebSocket 连接来源

3. **防火墙配置**
   - 只开放必要的端口
   - 限制后端服务访问来源

## 📄 许可证

本项目为内部项目，请遵循公司代码使用规范。

## 👥 贡献

欢迎提交 Issue 和 Pull Request！

## 📞 联系方式

如有问题，请联系开发团队。

---

**最后更新**: 2026-01-28
