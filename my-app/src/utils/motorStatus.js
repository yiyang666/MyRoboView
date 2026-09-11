/*
 * @Author: ethan.young Ethan.Yang2@lingyiitech.com
 * @Date: 2026-03-19 18:07:09
 * @LastEditors: ethan.young Ethan.Yang2@lingyiitech.com
 * @LastEditTime: 2026-03-23 16:08:48
 * @FilePath: /build_all/src/roboview/my-app/src/utils/motorStatus.js
 * @Description: 
 */
// 统一电机状态判定与颜色（供 MotorStatus / Robot3DView 复用）

export const MOTOR_DISPLAY_STATUS = {
  ok: { text: '正常', color: '#10b981' },
  warning: { text: '异常', color: '#f59e0b' },
  unknown: { text: '未知', color: '#6b7280' },
};

/**
 * @param {object} motor
 * @param {number} motor.u1_online 1=在线,0=离线
 * @param {number} motor.health 0=正常, 0x1000~0x1FFF=错误码
 */
export function getMotorDisplayStatus(motor) {
  const online = motor?.u1_online === 1;
  if (!online) {
    return { ...MOTOR_DISPLAY_STATUS.unknown, key: 'unknown', errors: '未知' };
  }

  const health = motor?.health;
  if (typeof health !== 'number') {
    return { ...MOTOR_DISPLAY_STATUS.unknown, key: 'unknown', errors: '未知' };
  }

  if (health === 0) {
    return { ...MOTOR_DISPLAY_STATUS.ok, key: 'ok', errors: '无' };
  }

  if (health >= 0x1000 && health <= 0x1fff) {
    const errorCode = health & 0x0fff;
    // 映射真实错误信息，暂定
    // const errorMessages = [];
    // if (errorCode & 0x0800) errorMessages.push('指令超限');
    // if (errorCode & 0x0400) errorMessages.push('母线电压过压');
    // if (errorCode & 0x0200) errorMessages.push('母线电压欠压');
    // if (errorCode & 0x0100) errorMessages.push('控制板温度过温');
    // if (errorCode & 0x0080) errorMessages.push('电机绕组温度过温');
    // if (errorCode & 0x0040) errorMessages.push('电机堵转');
    // if (errorCode & 0x0020) errorMessages.push('电机绕组过流');
    // if (errorCode & 0x0010) errorMessages.push('编码器数据错误');
    // const errText = errorMessages.length > 0 ? errorMessages.join(' | ') : '未知错误';
    // return { ...MOTOR_DISPLAY_STATUS.warning, key: 'warning', errors: errText };
    const hexCode = `0x${errorCode.toString(16).toUpperCase().padStart(4, '0')}`;
    return { ...MOTOR_DISPLAY_STATUS.warning, key: 'warning', errors: hexCode };
  }

  return { ...MOTOR_DISPLAY_STATUS.unknown, key: 'unknown', errors: '未知' };
}

// 说明：3D 关节着色已改为方案B（后端直接下发 ok/warning/offline 状态），
// 前端不再需要把本地判定结果二次映射为视觉状态，原 toJointVisualStatusKey 已移除。

