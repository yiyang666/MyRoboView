# 基线验证记录

日期：2026-09-11。范围：本次 develop ROS2 C++ Demo；不把原 LYOS 版或未连接的 Orin NX 算作已验证。

## 环境

- 本机 Ubuntu 24.04.4，x86_64，ROS2 Jazzy；默认 rmw_fastrtps_cpp。
- 两个 ament_cmake 包、C++17/rclcpp，Boost.System、JsonCpp。
- React 前端沿用原 RoboView 工具链，Node 20.20.2；运行节点无 rclpy 依赖。

## 本地通过项

| 检查 | 结果 |
|---|---|
| `./scripts/build.sh` | 两个包编译成功，自定义接口生成成功 |
| C++ core_test | 1 个测试程序通过；包含多项配置、状态和消息断言 |
| 配置负例 | 重复 ID、非法话题、错误 QoS、无效 depth/超时、非回环 host 均拒绝 |
| 消息反射 | BatteryState 标量/NaN、JointState 序列、Odometry 嵌套/定长数组、PlatformStatus、自定义大整数与过大数组 |
| 状态缓存 | waiting、逐话题 live/stale、Hz、错误显示、恢复清错 |
| 真实 DDS 集成 | 两个独立 C++ 进程经 DDS 传输五类话题，HTTP 读到真实订阅结果 |
| 配置驱动 | 测试将全部话题换成 /myroboview/integration/*，无需修改二进制 |
| 故障与恢复 | 单独停止电池生成、全部发布停止、超时 hz=0、重启恢复、warning 场景 |
| 接口边界 | GET health/state、POST 返回 405、任意文件路径返回 404 |
| 异常启动 | 不存在的消息包启动失败，非零退出 |
| 进程退出 | 测试 SIGTERM 后 5 秒内退出，测试进程清理完成 |
| React 生产构建 | `CI=true npm run build --prefix my-app` 成功 |
| React 开发代理 | 本机 3000 → C++ 8080 成功；不可信 Host 返回 403 |
| 浏览器 | 复用布局显示五话题在线；遥测/话题页可用；服务离线后显示未知/历史采样，不继续宣称在线 |

React 旧工具链在 loopback HOST 下使用 package.proxy 会出现 allowedHosts 配置错误；本轮改用 CRA 支持的 setupProxy.js 入口，显式限制本机 Host，并保持 /api 代理到 127.0.0.1:8080。未使用关闭 Host 检查的环境变量。

Jazzy 编译时 `get_typesupport_handle` 有弃用提醒：该调用为兼容 Humble 保留，构建通过；不表示消息类型支持加载失败。ROS_LOCALHOST_ONLY 在 Jazzy 上也有弃用提示但仍被遵守，用于和 Humble 共用本机隔离配置。

## 远程 CI

`.github/workflows/ros2.yml` 在 Humble/Jammy 和 Jazzy/Noble 官方 ROS 容器（x86_64）中构建并执行 C++/DDS 测试，**两组均通过**。

运行记录：[GitHub Actions #34589471452](https://github.com/yiyang666/MyRoboView/actions/runs/34589471452)，验证代码提交 `5bccb11`。后续仅补充本验证记录和开发约定，未修改运行代码。CI 的 Humble x86_64 结果不等于 Orin NX arm64 实机验收。

## 尚未验证 / 不在本轮验收内

- Orin NX arm64、板端真实机器人 app 与网络条件；Humble 当前仅在 x86_64 CI 容器验证。
- 8/24 小时长稳、负载容量、CPU/RSS 指标与时延目标。
- 所有可能 ROS 类型的穷举测试；当前是通用反射实现和典型标准/自定义类型验证。
- ROS2 QoS 不兼容诊断 UI、配置字段存在性、配置热加载与复杂 profile。
- 登录、写操作、导航、标定、TF/URDF、地图/点云/视频、日志运维。
- 原版所有前端组件的迁移/回归；Demo 只适配只读监控入口，不追求完整前端。

## 重现

```bash
export ROS_DISTRO=jazzy  # Orin 目标原生环境改为 humble
./scripts/build.sh
./scripts/test.sh
CI=true npm run build --prefix my-app
./scripts/run_demo.sh
# 另一终端
cd my-app
HOST=127.0.0.1 BROWSER=none npm start
```

执行集成测试前，测试 domain 178 不应运行其他同名测试发布者。实际 app 的 domain、命名空间、QoS 和消息包需另行核对。
