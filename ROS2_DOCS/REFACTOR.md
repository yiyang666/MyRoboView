# 重构说明

## 选择

采用参考 LYOS 版、独立实现 ROS2 Demo 的路线。Master 保留原始业务版；develop 移除私有 SDK、产品宏、动作与标定依赖。前端保留 React 布局和组件，并在 2026-09-16 从 CRA 迁移到 Vite 6；Vite 负责开发服务器、代理、产品注入和生产打包，不改变 ROS 消息契约。

本次将上一版共享平台包拆成独立 robotapp 和 Drogon backend。二者只有 ROS 消息契约关联，不共享运行配置，也不互相启动。

## 职责

- robotapp：C++ / rclcpp 发布机器人状态、标准 IMU、电机健康。独立配置发布话题和频率，正常模式按时间转换状态，fault 场景模拟异常。
- robot_msgs/node_app_msgs：RobotState、MotorHealth、MotorHealthArray、IotCmdMsg 的唯一自定义定义，colcon 生成类型支持。
- robot_msgs/ros_msgs：本机 Jazzy 标准消息参考快照及上游 package 元数据；不创建同名 ROS 包。编译链接系统标准消息，避免类型冲突。
- myroboview/backend：Drogon HTTP/WebSocket、rclcpp 通用订阅、ROS introspection 转 JSON、缓存和按配置频率广播。配置类型必须已安装类型支持。
- myroboview/frontend：复用原 React 布局、双产品关节映射、2D 地图画布、导航二级侧栏和任务卡片；接入新 WebSocket 话题帧和导航状态。构建输出按产品隔离到 `build/<产品>`。
- scripts：保留三个入口，更新为独立包路径；启动脚本退出清理自己的两个进程。

ROS 接收与网络发送分线程，缓存和客户端集合有锁保护。广播频率独立于接收频率，只发送最新缓存，waiting/stale/error 状态明确随帧发出。

## 导航来源与边界

参考 `/home/ethan/workspace/RoboView_history/roboview` 的 `release/lrd-w/rk3588/v1.1.0`（实际为 tag），提交 `ff313d860167a92dde432ab710920b17faaaaf0d`。
沿用测试地图、五个预置目标点和路线数据，重写独立导航状态逻辑。支持内存中的目标点/路线增删、启动、暂停、继续、停止、到点完成。重启恢复预置数据。

导航按直线路段插值，不做规划、避障或真实定位。按钮下发 `/iot/command`，校验通过后先发布命令再改变模拟状态；发布失败不推进状态。发布成功仅表示交给 ROS 中间件，不表示机器人已接收或执行。无 LYOS 依赖，不扫描真实机器地图、资源或日志路径。

程序改名为 `myroboview_server`：入口 `src/main.cpp`；订阅与解码 `src/ros_subscriber.cpp`；ROS 命令发布 `src/command_publisher.cpp`；HTTP 路由 `src/api.cpp`；内存模拟 `src/navigation.cpp`。Drogon 路由保留回调对象，因此退出前显式释放其持有的 ROS 发布器，避免静态析构晚于 ROS 上下文生命周期。仅由 ROS executor 退出路径请求一次 Drogon quit，避免旧版 Drogon 重复释放监听器。

前端保留 `asserts/<产品>` 下资源，不加载 URDF/STL 或任何 3D 场景。当前仅使用双产品关节 ID/名称配置供卡片显示；LRS-X / LRD-W Mock 分别为 26 / 16 个电机。

## 构建与安装边界

- `AI_TARGET_PRODUCT` 同源驱动 robotapp 配置、后端配置和 `REACT_APP_PRODUCT`，Vite 输出到 `frontend/build/<产品>`。
- 生产文档根为 `install/etc/web`：Vite 页面与 hash 文件位于根目录和 `static/`，地图位于 `assets/maps/`，当前产品 URDF 位于 `assets/robot_urdf/`。
- 安装时排除 Vite 从开发态 `public/robot_urdf` 复制出的资源，再从 `asserts/<产品>` 安装当前产品资源。
- 当前增量安装只清理 `static/`，尚未清理 CRA 时代的顶层文件和旧资源路径；认证配置也缺少干净检出环境的安全注入方案。两项均以 P1 记录在 [OPTIMIZED.md](OPTIMIZED.md)。

## 未完成事项

生产认证、慢客户端背压、长期压力测试、真实机器人执行反馈与 Orin NX 部署均未完成。默认回环监听；建图按钮只下发指令和改变模拟建图状态，底图保持预置 Demo，重启丢弃内存编辑。
