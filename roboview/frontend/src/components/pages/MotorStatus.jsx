import React, { useState } from 'react';
// 统一入口：由构建期 REACT_APP_PRODUCT 选中当前产品配置（见 config/robotUrdfConfig.js）
import { URDF_CONFIG } from '../../config/robotUrdfConfig';
import { HEALTH_STATUS, ONLINE_STATUS, MOTOR_DIRECTION } from '../../constants/robotEnums';
import './MotorStatus.css';

const number = (value, unit) => Number.isFinite(value) ? `${value.toFixed(2)} ${unit}` : '—';

// 卡片分级：数据不新鲜 > 离线 > 健康等级（故障/警告/正常），决定边框颜色与角标文案
function cardState(motor, fresh) {
  if (!fresh) return ['unknown', '未知'];
  if (motor.online_status === 1) return ['offline', '离线'];
  if (motor.health_status === 2) return ['error', '故障'];
  if (motor.health_status === 1) return ['warning', '警告'];
  return ['online', '正常'];
}

export default function MotorStatus({ snapshot, connected }) {
  const [profile, setProfile] = useState('product');
  const topic = snapshot?.topics.find(t => t.type === 'node_app_msgs/msg/MotorHealth');
  const motors = topic?.data?.motors || [];
  const fresh = connected && topic?.state === 'live';
  const onlineCount = motors.filter(m => m.online_status === 0).length;
  return <div className="page-container">
    <h2 className="page-title">电机状态</h2>
    <div className="motor-summary"><span>电机：{motors.length} 个 · {fresh ? `在线 ${onlineCount} 个` : '数据未更新，历史值仅供参考'}</span>
      <label>名称映射 <select value={profile} onChange={event => setProfile(event.target.value)}><option value="product">{URDF_CONFIG.displayName} 关节</option><option value="generic">电机编号</option></select></label>
    </div>
    {!motors.length && <p>等待电机健康消息…</p>}
    <div className="motor-grid">{motors.map(motor => {
      const joint = profile === 'product' && URDF_CONFIG.joints.find(j => j.id === motor.motor_id);
      const [cls, health] = cardState(motor, fresh);
      return <article className={`motor-card ${cls}`} key={motor.motor_id}>
        <header><h3><small>ID: {motor.motor_id}</small> {joint?.name || `电机 ${motor.motor_id}`}</h3><span>{health}</span></header>
        {joint && <code>{joint.urdfName}</code>}
        <dl><div><dt>在线状态</dt><dd>{ONLINE_STATUS[motor.online_status] || '未知'}</dd></div>
          <div><dt>健康状态</dt><dd>{HEALTH_STATUS[motor.health_status] || '未知'}</dd></div>
          <div><dt>电机方向</dt><dd>{MOTOR_DIRECTION[motor.motor_direction] || '未知'}</dd></div>
          <div><dt>电机温度</dt><dd>{number(motor.motor_temperature, '°C')}</dd></div>
          <div><dt>母线电压</dt><dd>{number(motor.motor_voltage, 'V')}</dd></div>
          <div><dt>位置零点</dt><dd>{number(motor.motor_position_zero_rad, 'rad')}</dd></div></dl>
      </article>;
    })}</div>
  </div>;
}
