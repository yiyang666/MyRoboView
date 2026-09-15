# 消息与接口

## 版本与迁移

2026-09-15 / Demo 1.0：ROS 消息契约升级为 **v2**，`node_app_msgs` 为 **0.3.0**。
这是 0.x 阶段的破坏性升级，不承诺与 0.2.0 的 DDS 类型兼容。HTTP/WS 外层
`schema_version=2` 保持不变；它描述传输信封，不代表其中 ROS 消息字段兼容。

| 0.2.0 / ROS v1 | 0.3.0 / ROS v2 | 消费端迁移 |
|---|---|---|
| RobotState 旧字段及字符串状态 | 类型、产品、个体身份；数值枚举及电池字段 | 按当前 `.msg` 重新生成类型并更新字段映射 |
| MotorHealthArray 数组消息 | MotorHealth 为数组载体 | 订阅类型改为 `node_app_msgs/msg/MotorHealth` |
| MotorHealth 为单电机元素 | MotorHealthState 为元素 | 更新字段；特别注意 online_status：0 在线、1 离线 |

升级时一起重建发布者、订阅者及 Python 类型环境，停止旧节点后启动新节点；
回滚时整组回滚。不能只改包版本让旧程序自动兼容。需要混跑旧实机程序时，
先增加独立适配节点和隔离话题；当前没有旧契约转换器。后续改变字段类型、
枚举语义或消息布局时必须更新包版本、此迁移记录和集成测试。

## ROS2

| 数据 | 类型 | 默认话题 | 发布 Hz | WS 广播 Hz |
|---|---|---|---:|---:|
| 机器人状态 | node_app_msgs/msg/RobotState | /robot/state | 20 | 5 |
| IMU | sensor_msgs/msg/Imu | /imu/data | 100 | 10 |
| 电机健康 | node_app_msgs/msg/MotorHealth | /motors/health | 10 | 2 |

机器人状态：robot_type（0人形/1四足轮式）、product、robot_id 随帧携带用于产品/个体区分；current_mode（0禁用/1准备/2运控）、current_action（0空闲/1跳跃/2行走/3奔跑/4转身/5挥手）、running_status（0空闲/1运行/2暂停/3故障）、motor_overall_status（0正常/1警告/2错误）、battery_temperature（°C）、battery_percentage（0–100%）、battery_voltage（V）。
电机健康：motor_count + motors 数组（≤64），元素字段 motor_id、health_status（0正常/1警告/2错误）、online_status（0在线/1离线）、motor_direction（1正向/-1反向）、motor_temperature（°C）、motor_voltage（V）、motor_position_zero_rad（rad）。精确定义见 `robot_msgs/node_app_msgs/msg`。
IMU 使用标准 sensor_msgs/Imu。robotapp 正常状态按 READY/空闲 → MOTION/行走 → MOTION/差异化动作（人形挥手、四足轮式奔跑）→ MOTION/暂停 四拍循环（state_step_sec 每拍），fault 场景整机 DISABLED/FAULT 并注入电机离线/警告/高温。

发布设置在 `robotapp/config/<PRODUCT>/robotapp.json`；订阅、QoS、广播频率、过期阈值在 `myroboview/backend/config/myroboview.json`。修改话题时两端各自配置一致。

## HTTP / WebSocket

- GET /api/v1/health：服务可用性，不表示 ROS 数据在线。
- GET /api/v1/state：完整配置与最新话题快照。
- /api/v1/telemetry（兼容 /ws）：连接时 hello.snapshot 携带全量快照，之后按各话题广播频率发送最新值。前端使用前者，避免 React 开发服务器 /ws 热更新路径冲突。

话题帧包含 schema_version=2、type（配置 event）、topic_id、topic、state、age_sec、received_count、receive_hz、error、data。state 为 waiting/live/stale/error；收到重复缓存不代表新的 ROS 消息，按 received_count 和 age_sec 判断。当前向所有连接广播全部配置话题，无按页面订阅过滤。客户端消息不能触发机器人操作。

## 导航 Demo

GET `/api/v1/nav/maps`、`/api/v1/nav/maps/current/resources`、`/api/v1/nav/state`。
POST `/api/v1/nav/maps/load`、`/api/v1/nav/waypoints`、`/api/v1/nav/routes`。
DELETE `/api/v1/nav/waypoints/{id}`、`/api/v1/nav/routes/{id}`。
POST `/api/v1/nav/tasks/route/start`、`pause`、`resume`、`stop`（后三者同路径前缀）。

具体请求字段与完整可执行示例见 `myroboview/backend/integration_tests/integration.py`。无效参数 400、不存在 404、状态冲突 409。WS nav_state 默认 5 Hz，位姿沿预置路线移动。地图和路线编辑仅存在内存中；navigation.enabled=false 时导航接口不可用。

## 下行指令

固定话题 `/iot/command`，类型 `node_app_msgs/msg/IotCmdMsg`，四个 string 字段 category、fun_name、sub、param。QoS reliable / volatile / depth=10；sub 当前为空。字段语义参考历史 LRD-W tag；此 ROS2 类型不依赖 LYOS 二进制 SDK。

| HTTP POST 操作 | category / fun_name | 请求体 | param |
|---|---|---|---|
| /api/v1/nav/maps/load | MAP / LOAD | map_id | 地图名称 |
| /api/v1/nav/mapping/start | MAP / START | map_name | online,地图名称 |
| /api/v1/nav/mapping/stop | MAP / STOP | {} | 空 |
| /api/v1/nav/localization/start | LOC / START | {} | 空 |
| /api/v1/nav/localization/manual | LOC / START | x,y,yaw（数值） | x,y,yaw |
| /api/v1/nav/tasks/route/start | NAV / START | route_id | x,y,yaw;x,y,yaw;… |
| /api/v1/nav/tasks/route/pause | NAV / PAUSE | {} | 空 |
| /api/v1/nav/tasks/route/resume | NAV / RESUME | {} | 空 |
| /api/v1/nav/tasks/route/stop | NAV / STOP | {} | 空 |

坐标单位 m，朝向 rad；序列化为固定六位小数、英文小数点。NAV/START 使用线路顺序中的全部目标点。目标点/线路增删不发布命令。
示例：`{"category":"NAV","fun_name":"START","sub":"","param":"13.138000,14.785000,-1.512000;13.792000,11.971000,-0.840000"}`。

后端先校验请求与状态，再发布，成功后推进模拟状态；无效请求不发消息，发布异常不推进状态。响应 published=true 仅表示消息已交给中间件，不保证接收或执行；当前未实现执行 ACK。导航任务在后端模拟，robotapp 仍独立发布传感器/健康状态，不消费指令。
建图仅模拟 active 状态，不生成真实地图；手动定位改变演示位姿。建图、导航和定位之间有状态冲突校验。
