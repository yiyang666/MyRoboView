// Original RoboView info-card presentation, driven by the backend profile.
import React from 'react';
import './Page.css';

export default function SystemInfo({ robot, connected }) {
  const fields = [
    ['机器人名称', robot?.name], ['机器人 ID', robot?.id],
    ['平台说明', robot?.description], ['数据通路', 'ROS2 → Drogon → WebSocket'],
    ['接口状态', connected ? '在线' : '离线'], ['功能范围', '实时监控与导航指令'],
  ];
  return <div className="page-container"><h2 className="page-title">系统信息</h2>
    <div className="info-grid">{fields.map(([label, value]) => <div className="info-card" key={label}><h3>{label}</h3><div className="info-value">{value || '—'}</div></div>)}</div>
    <p className="ros2-note">当前在本机运行 robotapp 模拟数据和导航演示。Orin NX 为后续部署目标。</p>
  </div>;
}
