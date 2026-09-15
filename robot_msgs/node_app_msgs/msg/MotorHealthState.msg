# Direction is configured rotation polarity, not instantaneous velocity direction.

uint16 motor_id

# 电机健康状态
uint8 HEALTH_OK = 0
uint8 HEALTH_WARNING = 1
uint8 HEALTH_ERROR = 2
uint8 health_status

# 电机在线状态
uint8 STATUS_ONLINE = 0
uint8 STATUS_OFFLINE = 1
uint8 online_status

# 电机方向
int8 FORWARD=1
int8 REVERSE=-1
int8 motor_direction

# 电机温度
float32 motor_temperature

# 电机电压
float32 motor_voltage

# 电机位置零点
float32 motor_position_zero_rad
