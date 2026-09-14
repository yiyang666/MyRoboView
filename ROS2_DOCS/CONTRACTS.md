# 消息与接口

## ROS2

| 数据 | 类型 | 默认话题 | 发布 Hz | WS 广播 Hz |
|---|---|---|---:|---:|
| 机器人状态 | node_app_msgs/msg/RobotState | /robot/state | 20 | 5 |
| IMU | sensor_msgs/msg/Imu | /imu/data | 100 | 10 |
| 电机健康 | node_app_msgs/msg/MotorHealthArray | /motors/health | 10 | 2 |

机器人状态：current_mode、current_action、running_status（0空闲/1运行/2暂停/3故障）、motor_status（0正常/1警告/2错误）、battery_percentage（0–100%）、battery_voltage（V）。
电机数组：motor_id、name、online、direction（1正向/-1反向）、temperature_celsius（摄氏度）、bus_voltage（V）、position_zero_rad（rad）。精确定义见 `robot_msgs/node_app_msgs/msg`。
IMU 使用标准 sensor_msgs/Imu。robotapp 正常状态按 STANDBY/HOLD → AUTO/WALK → AUTO/TURN → AUTO/HOLD 循环，fault 场景覆盖为故障。

发布设置在 `robotapp/config/robotapp.json`；订阅、QoS、广播频率、过期阈值在 `myroboview/backend/config/myroboview.json`。修改话题时两端各自配置一致。

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
