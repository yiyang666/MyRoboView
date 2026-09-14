# Robot application state, contract v1. Battery percentage is 0..100.
std_msgs/Header header
string<=64 robot_id
string<=32 current_mode
string<=32 current_action
uint8 IDLE=0
uint8 RUNNING=1
uint8 PAUSED=2
uint8 FAULT=3
uint8 running_status
uint8 MOTOR_OK=0
uint8 MOTOR_WARNING=1
uint8 MOTOR_ERROR=2
uint8 motor_status
float32 battery_percentage
float32 battery_voltage
