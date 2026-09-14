// Reuse the original RoboView navigation layout.
import React from 'react';
import './Sidebar.css';

const items = [
  { id: 'telemetry', label: '实时监控', icon: '📊' },
  { id: 'motors', label: '电机状态', icon: '⚙️' },
  { id: 'navigation', label: '地图导航', icon: '🗺️' },
  { id: 'topics', label: '话题健康', icon: '📡' },
  { id: 'system', label: '系统信息', icon: '🤖' },
];
export default function Sidebar({ selectedMenu, onMenuSelect }) {
  return <div className="sidebar">
    <div className="sidebar-header"><h2>🤖 MyRoboView</h2></div>
    <nav className="sidebar-nav">{items.map(item => <button key={item.id} className={`menu-item ${selectedMenu === item.id ? 'active' : ''}`} onClick={() => onMenuSelect(item.id)}>
      <span className="menu-icon">{item.icon}</span><span className="menu-label">{item.label}</span>
    </button>)}</nav>
    <div className="sidebar-footer"><div className="version-info">ROS2 Jazzy · Demo 0.3<br />MyRoboView · 机器人监控</div></div>
  </div>;
}
