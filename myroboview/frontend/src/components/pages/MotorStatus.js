import React, { useState } from 'react';
import { URDF_CONFIG } from '../../config/robotUrdfConfig';
import './MotorStatus.css';

const number = (value, unit) => Number.isFinite(value) ? `${value.toFixed(2)} ${unit}` : '—';
export default function MotorStatus({ snapshot, connected }) {
  const [profile, setProfile] = useState('lrd-w');
  const topic = snapshot?.topics.find(t => t.type === 'node_app_msgs/msg/MotorHealthArray');
  const motors = topic?.data?.motors || [];
  const fresh = connected && topic?.state === 'live';
  return <div className="page-container">
    <h2 className="page-title">电机状态</h2>
    <div className="motor-summary"><span>电机：{motors.length} 个 · {fresh ? `在线 ${motors.filter(m => m.online).length} 个` : '数据未更新，历史值仅供参考'}</span>
      <label>名称映射 <select value={profile} onChange={event => setProfile(event.target.value)}><option value="lrd-w">LRD-W 关节</option><option value="generic">消息原始名称</option></select></label>
    </div>
    {!motors.length && <p>等待电机健康消息…</p>}
    <div className="motor-grid">{motors.map(motor => {
      const joint = profile === 'lrd-w' && URDF_CONFIG.joints.find(j => j.id === motor.motor_id);
      const health = !fresh ? '未知' : motor.online ? '在线' : '离线';
      return <article className={`motor-card ${fresh ? motor.online ? 'online' : 'offline' : 'unknown'}`} key={motor.motor_id}>
        <header><h3><small>ID: {motor.motor_id}</small> {joint?.name || motor.name || `电机 ${motor.motor_id}`}</h3><span>{health}</span></header>
        {joint && <code>{joint.urdfName}</code>}
        <dl><div><dt>在线状态</dt><dd>{fresh ? motor.online ? 'Online' : 'Offline' : '未知'}</dd></div>
          <div><dt>电机方向</dt><dd>{motor.direction === 1 ? '正转' : motor.direction === -1 ? '反转' : '未知'}</dd></div>
          <div><dt>电机温度</dt><dd>{number(motor.temperature_celsius, '°C')}</dd></div>
          <div><dt>母线电压</dt><dd>{number(motor.bus_voltage, 'V')}</dd></div>
          <div><dt>位置零点</dt><dd>{number(motor.position_zero_rad, 'rad')}</dd></div></dl>
      </article>;
    })}</div>
  </div>;
}
