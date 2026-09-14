// Original RoboView info-card presentation, now driven by the bridge profile.
import React from 'react';
import './Page.css';

export default function SystemInfo({ robot, connected }) {
  const fields = [
    ['机器人名称', robot?.name], ['机器人 ID', robot?.id],
    ['平台说明', robot?.description], ['数据通路', 'ROS2 → C++ bridge → HTTP'],
    ['接口状态', connected ? '在线' : '离线'], ['运行权限', '只读监控'],
  ];
  return <div className="page-container"><h2 className="page-title">系统信息</h2>
    <div className="info-grid">{fields.map(([label, value]) => <div className="info-card" key={label}><h3>{label}</h3><div className="info-value">{value || '—'}</div></div>)}</div>
    <p className="ros2-note">部署目标：Orin NX。此处配置不表示已连接该设备；mock_* 模式为合成数据。</p>
  </div>;
}
