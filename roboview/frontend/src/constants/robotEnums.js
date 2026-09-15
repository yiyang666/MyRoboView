/**
 * 消息枚举 → 中文显示映射（与 node_app_msgs/msg/*.msg 中的常量一一对应）
 * 注意 online_status 语义与布尔直觉相反：0=在线，1=离线
 */

// RobotState（机器人状态）
export const CURRENT_MODE = ['禁用', '准备', '运控'];
export const CURRENT_ACTION = ['空闲', '跳跃', '行走', '奔跑', '转身', '挥手'];
export const RUNNING_STATUS = ['空闲', '运行', '暂停', '故障'];
export const MOTOR_OVERALL_STATUS = ['正常', '警告', '故障'];

// MotorHealthState（电机健康）
export const HEALTH_STATUS = ['正常', '警告', '故障'];
export const ONLINE_STATUS = ['在线', '离线'];
export const MOTOR_DIRECTION = { 1: '正转', '-1': '反转' };

// 字段路径末段 → 枚举映射：供实时监控卡片等"服务端配置驱动"的展示路径查表
const FIELD_ENUMS = {
  current_mode: CURRENT_MODE,
  current_action: CURRENT_ACTION,
  running_status: RUNNING_STATUS,
  motor_overall_status: MOTOR_OVERALL_STATUS,
  health_status: HEALTH_STATUS,
  online_status: ONLINE_STATUS,
  motor_direction: MOTOR_DIRECTION,
};

// 命中枚举返回中文文案；未命中返回 null，调用方走默认数值格式化
export function enumLabel(fieldPath, value) {
  if (value == null) return null;
  const map = FIELD_ENUMS[String(fieldPath).split('.').pop()];
  if (!map) return null;
  return map[value] ?? null;
}
