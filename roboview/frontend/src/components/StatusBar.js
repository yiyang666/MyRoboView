// Reuse RoboView's status-bar layout and battery treatment with neutral ROS2 fields.
import React from 'react';
import './StatusBar.css';

export default function StatusBar({ snapshot, connected }) {
  const topics = snapshot?.topics || [];
  const live = topics.filter(t => t.state === 'live').length;
  const status = topics.find(t => t.type === 'node_app_msgs/msg/RobotState' && t.state === 'live')?.data;
  const power = connected && Number.isFinite(status?.battery_percentage) ? Math.max(0, Math.min(100, status.battery_percentage)) : null;
  const mode = connected ? status?.current_mode : null;
  const color = power == null ? '#9ca3af' : power > 50 ? '#10b981' : power > 20 ? '#f59e0b' : '#ef4444';
  return <div className="status-bar">
    <div className="status-left">
      <div className="status-item"><span className="status-label">服务:</span><span className={`status-value ${connected ? 'connected' : 'disconnected'}`}>{connected ? '● 已连接' : '○ 未连接'}</span></div>
      <div className="status-item"><span className="status-label">话题:</span><span className="status-value">{connected ? `${live}/${topics.length} 在线` : '未知'}</span></div>
      <div className="status-item"><span className="status-label">模式:</span><span className="status-value">{mode || '—'}</span></div>
      <div className="status-item"><span className="status-label">状态:</span><span className="status-value">{!connected ? '服务离线' : !status ? '等待状态' : ['空闲', '运行', '暂停', '故障'][status.running_status] || '未知'} · {connected ? status?.current_action || '—' : '—'}</span></div>
    </div>
    <div className="status-right"><div className="status-item"><span className="status-label">电量:</span><div className="battery-container">
      <div className="battery-level" style={{ width: `${power ?? 0}%`, backgroundColor: color }} /><span className="battery-text">{power == null ? '—' : `${power.toFixed(0)}%`}</span>
    </div></div></div>
  </div>;
}
