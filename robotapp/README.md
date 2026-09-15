# robotapp

独立 C++ ROS2 模拟机器人应用（demo 数据源）：只发布话题，不依赖 Drogon / roboview 后端。
真实机器人接入时**不要启动**，避免与真实 app 的同名话题冲突。

## 发布内容

话题名与频率全部由配置的 `topics` 段决定，默认值如下：

| 话题 key | 消息类型 | 默认话题 | 默认 Hz |
|---|---|---|---:|
| robot_state | node_app_msgs/msg/RobotState | /robot/state | 20 |
| imu | sensor_msgs/msg/Imu | /imu/data | 100 |
| motor_health | node_app_msgs/msg/MotorHealth | /motors/health | 10 |

消息契约详见 `robot_msgs/node_app_msgs/msg/` 与 `ROS2_DOCS/CONTRACTS.md`。

## 双产品 mock

配置按产品拆分在 `config/<产品>/robotapp.json`，构建时按 `AI_TARGET_PRODUCT` **只安装对应那份**到
`install/etc/robotapp/robotapp.json`（配置缺失会在 CMake configure 阶段直接报错）。

| 产品 | robot.type | motor_count | 状态机动作集 |
|---|---|---:|---|
| lrs-x | humanoid（小人形） | 26 | WALK + WAVE（挥手） |
| lrd-w | quadruped_wheeled（四足轮式） | 16 | WALK + RUN（奔跑） |

`robot` 段的 `type/product/id` 会随每帧 RobotState 携带，前端据此做产品差异化展示
（电机卡片数量、关节名称映射等）。

## 配置字段

```json
{
  "robot":    { "type": "humanoid", "product": "lrs-x", "id": "lrs-x-01" },
  "scenario": "nominal",
  "state_step_sec": 3.0,
  "motor_count": 26,
  "topics":   { "robot_state": {"name": "/robot/state", "hz": 20}, "...": {} }
}
```

- `robot.type`：`humanoid` | `quadruped_wheeled`（映射 RobotState.robot_type 枚举）
- `robot.product` / `robot.id`：产品代号 / 个体编号，透传到消息
- `scenario`：`nominal`（默认）| `fault`。fault 注入整机 DISABLED/FAULT，
  且 0 号电机离线+故障+85°C、1 号电机警告+75°C，用于演示电机卡片的颜色分级
- `state_step_sec`：状态机节拍秒数。正常按 READY/空闲 → MOTION/WALK →
  MOTION/(WAVE|RUN，按机型) → MOTION/暂停 四拍循环
- `motor_count`：1–64，与 MotorHealth.motors 数组长度一致
- `topics.<key>.name/hz`：话题名须为唯一的绝对路径，hz 0.1–500

配置在启动时严格校验（类型/范围/重复键），非法直接报错退出。

## 代码结构

```
robotapp/
├── CMakeLists.txt                # 构建 + 按产品安装配置
├── config/<产品>/robotapp.json   # 双产品配置（唯一事实来源）
├── src/main.cpp                  # 配置加载/校验 + 三个定时发布器
├── include/robotapp/state_machine.hpp  # 显式节拍状态机（动作按 robot_type 差异化）
└── test/state_machine_test.cpp   # 状态机单测（含双产品动作断言）
```

## 构建与运行

- 构建：外层 `build_all_robot` 下 `make <产品>_x86_64`；无外层体系时仓内 `scripts/build.sh --local`
- 单独启动：`scripts/run_robotapp.sh [-p lrs-x|lrd-w]`
  （默认读安装前缀下 `etc/robotapp/robotapp.json`，`--config PATH` 可覆盖）
- 无前端联调：`scripts/run_demo.sh`（robotapp + backend 一起拉起）
- 完整联调：`run_robotapp.sh` + `scripts/start_dev.sh`（前端热更新）

## 测试

`scripts/test.sh [-p 产品]` 会跑状态机单元测试；集成测试
`roboview/backend/integration_tests/integration.py` 按产品读取本目录
`config/<产品>/robotapp.json` 驱动 mock，并断言双产品动作集差异。
