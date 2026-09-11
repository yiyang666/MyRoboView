# 配置、HTTP 与 ROS2 消息契约 v1

## 配置

唯一示例：[config/demo.json](src/myroboview_platform/config/demo.json)。配置在启动前解析和校验；失败返回非零退出码，不悄悄使用默认话题。

| 字段 | 含义/约束 |
|---|---|
| schema_version | 当前严格等于整数 1 |
| robot.id / name | 标识和显示名；id 最多 64 字节 |
| server.host / port | 当前仅 127.0.0.1；端口 1024–65535 |
| server.poll_ms | 网页刷新间隔，200–5000 ms，默认 500 |
| topics | 1–32 项；id 与绝对 topic 名分别唯一 |
| id / label | 稳定内部键与显示名称 |
| topic / type | ROS2 绝对话题名、`package/msg/Message` |
| stale_sec | 0.1–3600 秒；逐话题判断，使用接收端单调时钟 |
| qos.reliability | reliable 或 best_effort |
| qos.durability | volatile 或 transient_local |
| qos.depth | KEEP_LAST 深度，1–100 |
| metrics | 至多 16 项；label、field、unit、可选 scale（默认 1） |
| mock.kind / hz | 可选；status/battery/imu/joints/odom，0.1–100 Hz |

`field` 使用点路径，例如 `pose.pose.position.x`、`position.0`；`scale` 只做数值乘法，无任意表达式执行。字段缺失或值未知显示 `—`。当前检查路径语法，尚未在启动时检查路径是否存在于消息定义，属于 P1 工作。

服务重启后重新读取配置；不支持热加载。修改指标或话题名不需要编译；新增消息类型需要先构建/安装该消息包。类型动态加载失败时启动失败。

## 标准话题与最小 Mock

| 默认 topic | 类型 | 频率 / QoS | 用途 |
|---|---|---|---|
| /myroboview/demo/status | myroboview_interfaces/msg/PlatformStatus | 2 Hz / reliable volatile | app/资源状态 |
| /myroboview/demo/battery | sensor_msgs/msg/BatteryState | 2 Hz / best_effort volatile | percentage 为 0–1，网页乘 100 |
| /myroboview/demo/imu | sensor_msgs/msg/Imu | 20 Hz / best_effort volatile | SI 单位、四元数姿态 |
| /myroboview/demo/joint_states | sensor_msgs/msg/JointState | 10 Hz / best_effort volatile | 名称和位置/速度/力矩数组 |
| /myroboview/demo/odom | nav_msgs/msg/Odometry | 10 Hz / best_effort volatile | odom→base_link，圆形演示轨迹 |

bridge 没有固定这五种类型；Mock 只实现这五种类型的生成器。真实机器人可以只用标准消息，不强制发布自定义状态。后续主机资源采集、Diagnostics、Map/Path 不挤进一个超大自定义消息。

QoS 遵守 ROS2 requested/offered 匹配：best_effort 订阅可兼容两种可靠性发布；reliable 订阅不能匹配 best_effort 发布。首版保留明确可配置策略，不自动切换 QoS 掩盖问题。地图等晚加入需取最后一帧的场景应配 transient_local，并确保发布端提供兼容 QoS。[ROS2 QoS 官方说明](https://docs.ros.org/en/humble/Concepts/Intermediate/About-Quality-of-Service-Settings.html)

## 自定义 PlatformStatus.msg

原始定义：[PlatformStatus.msg](src/myroboview_interfaces/msg/PlatformStatus.msg)。这是本仓库自行定义的契约，不引用 LYOS 业务消息。

| 字段 | 语义 |
|---|---|
| header.stamp | 发布端 ROS 时钟时间，可为仿真时间；不用于接收端超时 |
| header.frame_id | 默认 base_link；资源信息本身不需要空间变换 |
| robot_id | 最长 64 字节的机器人标识，应与 profile 对应 |
| level | OK=0、WARN=1、ERROR=2；业务健康等级，与话题连接状态分离 |
| mode | 最长 32 字节的 app 模式文本；Demo 使用 mock_nominal/mock_warning |
| cpu_percent / memory_percent | float32，百分比 0–100；实际发布方负责范围与语义 |
| uptime_sec | 发布 app 的运行秒数，uint64 |
| summary | 最长 160 字节的简述，不承载大日志 |

未知资源值可以使用 NaN，Web JSON 转为 null。真实 app 不应为了填充字段而伪造 0 或“正常”。`level` 无未知枚举，未获得 app 状态时应不发布该消息或建立下一版明确契约。

更改消息布局会改变 ROS 类型兼容性，所有参与端必须一起编译部署；不把“加字段”当作无需升级的兼容变更。v1 冻结后重大调整用新类型（例如 PlatformStatusV2）和新配置版本。当前不是业务 RPC，不携带使能、急停、动作编号、导航任务和电机厂商码。

## JSON 与状态

`/api/v1/state` 返回 `schema_version`、`transport=ros2`、robot、poll_ms、topics 数组。每个话题包含原配置（移除 mock）、data、state、age_sec、hz、count、error。

- waiting：尚未收到消息，data/age_sec 为 null。
- live：收到可解析消息且未超时。
- stale：超过 stale_sec，保留最后值供诊断，hz=0。
- error：消息转换/体积限制失败；保留旧值但显式报告错误。下一条合法消息自动恢复。

服务失联是第五种浏览器显示状态，不替代上述 ROS 状态；HTTP 健康检查只代表服务存活。每个话题独立计时，不能用 IMU 高频数据掩盖状态话题断流。

消息反射支持标量、字符串、宽字符串、嵌套消息、定长数组和序列；NaN/Inf 转 null，超出 JavaScript 精确整数范围的 int64/uint64 转十进制字符串。输入 CDR 和输出 JSON 单条各限制 128 KiB，解析最多 8192 个标量、嵌套深度 16。大图像、点云和地图不适合本通道，应设计独立适配器；限制失败不能默默截断。

## 隔离与多机器人

首版一个 bridge 实例对应一个 robot profile。多机器人先使用不同命名空间、不同端口/配置；集中式 fleet 管理另行设计。推荐真实机器人上只运行 bridge，使用 SSH 向开发机转发网页，减少跨发行版/跨机 DDS 的不确定性。
