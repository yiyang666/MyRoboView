# robotapp

独立 C++ ROS2 模拟机器人应用，仅发布状态、IMU、电机健康，不依赖 Drogon 或 backend。
入口 src/main.cpp；状态机 include/robotapp/state_machine.hpp；独立配置 config/robotapp.json。
构建及独立启动方式见根 README。scenario 可选 nominal/fault，state_step_sec 控制状态转换周期。
