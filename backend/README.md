# 机器人监控后端服务

基于 **C++ (Drogon)** 框架的机器人监控系统后端服务。

## 功能特性

- ✅ RESTful API 接口
- ✅ WebSocket 实时通信
- ✅ 机器人状态管理（线程安全）
- ✅ 多客户端支持
- ✅ CORS 支持
- ✅ 高性能异步架构

## 快速开始

### 前置要求

1. **C++17 编译器** (GCC 7+, Clang 5+)
2. **CMake 3.15+**
3. **Drogon 框架** - 安装说明见下方
4. **jsoncpp** - JSON 解析库
5. **OpenSSL**（libcrypto）- JWT 与 TLS 相关依赖

### 认证配置

启动前需在进程工作目录下提供 `config/auth_users.json`，或设置环境变量 `ROBOT_MONITOR_AUTH_CONFIG` 指向该文件。说明、默认账号与改密流程见 **[config/AUTH_MAINTENANCE.md](./config/AUTH_MAINTENANCE.md)**。

### 安装 Drogon

**推荐方式：从源码编译**

详细安装说明请参考：
[Drogon 官方安装文档](https://github.com/drogonframework/drogon/wiki/Installation)
快速安装：
[INSTALL_DROGON.md](./INSTALL_DROGON.md)


### 构建项目

```bash
cd roboview/backend
make build
```

### 运行服务

```bash
make run
```

或直接运行：
```bash
./build/robot_monitor_backend
```

## API 端点

### REST API

- `GET /api/v1/status` - 获取机器人状态
- `POST /api/v1/control/start` - 启动机器人
- `POST /api/v1/control/stop` - 停止机器人
- `POST /api/v1/control/reset` - 重置机器人
- `POST /api/v1/control/joint` - 设置关节角度

**请求示例**:
```bash
# 获取状态
curl http://localhost:8080/api/v1/status

# 设置关节角度
curl -X POST http://localhost:8080/api/v1/control/joint \
  -H "Content-Type: application/json" \
  -d '{"joint_id": "joint1", "angle": 45.0}'
```

### WebSocket

- `ws://localhost:8080/ws` - WebSocket 连接端点

**消息格式**:
```json
// 客户端发送
{
  "type": "command",
  "command_type": "start",
  "timestamp": 1234567890
}

// 服务器推送
{
  "type": "robot_state",
  "data": {
    "battery": 100,
    "voltage": 24.0,
    "status": "running",
    "joints": [...]
  },
  "timestamp": 1234567890
}
```

## 配置

默认配置：
- 端口: 8080
- 主机: 0.0.0.0

修改端口在 `src/main.cpp` 中：
```cpp
app().addListener("0.0.0.0", 8080);  // 修改端口号
```

## 项目结构

```
backend/
├── CMakeLists.txt          # CMake 构建配置
├── Makefile                # 构建脚本
├── include/                # 头文件
│   ├── robot_state.h      # 状态管理
│   ├── websocket_handler.h # WebSocket 处理
│   └── api_handlers.h      # REST API 处理
└── src/                    # 源文件
    ├── main.cpp            # 主程序
    ├── robot_state.cpp     # 状态实现
    ├── websocket_handler.cpp # WebSocket 实现
    └── api_handlers.cpp    # API 实现
```

## 开发

### 添加新功能

1. 在相应的头文件中声明函数
2. 在源文件中实现功能
3. 在 `main.cpp` 中注册路由（如需要）
4. 重新构建并测试

### 使用 Makefile

```bash
# 构建
make build

# 运行
make run

# 清理
make clean

# 显示帮助
make help
```

## ROS2 集成

C++ 后端为 ROS2 集成做好了准备：

1. **C++ 原生** - 无需语言桥接
2. **线程安全** - 状态管理器已实现线程安全
3. **消息格式** - 使用 JSON，易于与 ROS2 消息转换

未来可以轻松添加 ROS2 话题订阅和发布功能。

## 故障排除

### 编译错误：找不到 Drogon

```bash
# 检查安装
ls /usr/local/lib/libdrogon*
ls /usr/local/lib/cmake/Drogon/

# 如果未安装，参考上方安装步骤
# 如果已安装但找不到，设置 CMAKE_PREFIX_PATH
export CMAKE_PREFIX_PATH=/usr/local:$CMAKE_PREFIX_PATH
```

### 链接错误：找不到 jsoncpp

```bash
sudo apt-get install libjsoncpp-dev
```

### 运行时错误：端口被占用

```bash
# 查找占用进程
lsof -i :8080
# 结束进程
kill -9 <PID>
```

## 参考资源

- [Drogon 官方文档](https://drogon.docsforge.com/)
- [Drogon GitHub](https://github.com/drogonframework/drogon)
- [Drogon 安装指南](https://github.com/drogonframework/drogon/wiki/Installation)
- [ROS2 文档](https://docs.ros.org/)

## 许可证

内部项目，遵循公司代码使用规范。
