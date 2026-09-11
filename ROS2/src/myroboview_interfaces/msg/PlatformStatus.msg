# Schema v1. Host/app health only; actuator and navigation semantics stay outside.
std_msgs/Header header
uint8 OK=0
uint8 WARN=1
uint8 ERROR=2
string<=64 robot_id
uint8 level
string<=32 mode
float32 cpu_percent
float32 memory_percent
uint64 uptime_sec
string<=160 summary
