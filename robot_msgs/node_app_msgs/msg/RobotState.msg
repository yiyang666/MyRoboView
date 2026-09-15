# Robot application state, contract v1. Battery percentage is 0..100.
std_msgs/Header header

# 机器人类型：0-小人形，1-四足轮式
uint8 TYPE_HUMANOID = 0
uint8 TYPE_QUADRUPED_WHEELED = 1
uint8 robot_type
# 产品代号
string<=64 product
# 产品编号
string<=64 robot_id

# 当前模式: 0-禁用，1-准备，2-运控
uint8 MODE_DISABLED = 0
uint8 MODE_READY = 1
uint8 MODE_MOTION = 2
uint8 current_mode

# 当前动作: 0-空闲，1-跳跃，2-行走，3-奔跑，4-转身，5-挥手
uint8 ACTION_IDLE = 0
uint8 ACTION_JUMP = 1
uint8 ACTION_WALK = 2
uint8 ACTION_RUN = 3
uint8 ACTION_TURN = 4
uint8 ACTION_WAVE = 5
uint8 current_action

# 当前状态: 0-空闲，1-运行，2-暂停，3-故障
uint8 STATUS_IDLE = 0
uint8 STATUS_RUNNING = 1
uint8 STATUS_PAUSED = 2
uint8 STATUS_FAULT = 3
uint8 running_status

# 电机总体状态: 0-正常，1-警告，2-故障
uint8 MOTOR_OK = 0
uint8 MOTOR_WARNING = 1
uint8 MOTOR_ERROR = 2
uint8 motor_overall_status

# 电池状态: 温度，电量，电压
float32 battery_temperature
float32 battery_percentage
float32 battery_voltage
