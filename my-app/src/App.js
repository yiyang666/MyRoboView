import React, { useState } from 'react';
import './App.css';
import './components/pages/Page.css';
import './ros2/demo.css';
import Sidebar from './components/Sidebar';
import StatusBar from './components/StatusBar';
import SystemInfo from './components/pages/SystemInfo';
import useRos2State from './ros2/useRos2State';

const labels = { live: '实时', stale: '已超时', waiting: '等待消息', error: '数据异常' };
function field(data, path) {
  return path.split('.').reduce((value, key) => value != null && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : null, data);
}
function display(value, scale = 1) {
  if (value == null) return '—';
  if (typeof value === 'number') return Number.isFinite(value * scale) ? (value * scale).toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : '—';
  return String(value);
}
export default function App() {
  const [menu, setMenu] = useState('telemetry');
  const [inspected, setInspected] = useState('');
  const { snapshot, connected } = useRos2State();
  const topics = snapshot?.topics || [];
  const selected = topics.find(t => t.id === inspected) || topics[0];
  return <div className="app-container">
    <Sidebar selectedMenu={menu} onMenuSelect={setMenu} />
    <main className="main-content">
      <StatusBar snapshot={snapshot} connected={connected} />
      {!connected && <div className="ros2-warning" role="alert">正在连接监控服务；已有数值为历史采样。</div>}
      {menu === 'system' ? <SystemInfo robot={snapshot?.robot} connected={connected} /> : <div className="page-container">
        <h2 className="page-title">{menu === 'telemetry' ? `${snapshot?.robot.name || '机器人'} · 实时监控` : 'ROS2 话题健康'}</h2>
        {menu === 'telemetry' ? <div className="sensor-grid">{topics.map(topic => <article key={topic.id} className={`sensor-card ${!connected || topic.state !== 'live' ? 'disconnected' : ''}`}>
          <div className="page-card-header"><h3>{topic.label}</h3><span className="ros2-badge">{connected ? labels[topic.state] : '服务离线'}</span></div>
          <div className="sensor-values">{topic.metrics.map(metric => <div className="sensor-value" key={metric.field}><label>{metric.label}</label><span>{display(field(topic.data, metric.field), metric.scale)} <small>{metric.unit}</small></span></div>)}</div>
          <code className="ros2-topic">{topic.topic}</code>{topic.error && <p className="ros2-warning">{topic.error}</p>}
        </article>)}</div> : <div className="ros2-table"><table><thead><tr><th>话题 / 消息类型</th><th>状态</th><th>频率</th><th>接收年龄</th><th>消息数</th></tr></thead><tbody>{topics.map(topic => <tr key={topic.id}><td><code>{topic.topic}</code><small>{topic.type}</small></td><td>{connected ? labels[topic.state] : '服务离线'}</td><td>{connected ? `${topic.hz} Hz` : '—'}</td><td>{connected && topic.age_sec != null ? `${topic.age_sec.toFixed(1)} s` : '—'}</td><td>{topic.count}</td></tr>)}</tbody></table></div>}
        <section className="ros2-inspector"><h3>消息检查器</h3><select aria-label="选择检查的话题" value={selected?.id || ''} onChange={event => setInspected(event.target.value)}>{topics.map(topic => <option key={topic.id} value={topic.id}>{topic.label}</option>)}</select><pre>{selected ? JSON.stringify({ state: connected ? selected.state : 'service_offline', error: selected.error, data: selected.data }, null, 2) : '等待消息…'}</pre></section>
      </div>}
    </main>
  </div>;
}
