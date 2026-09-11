import React from 'react';

const fmt = (n, digits = 2) => {
  if (typeof n !== 'number' || Number.isNaN(n)) return '--';
  return n.toFixed(digits);
};

/** 地图右上角半透明状态卡片：纵向排列 */
const NavStatusBar = ({ navState, connectionState }) => {
  const pose = navState?.pose || {};
  const twist = navState?.twist || {};

  const stateText =
    connectionState === 'timeout'
      ? '超时'
      : connectionState === 'disconnected'
        ? '离线'
        : '在线';
  const stateClass =
    connectionState === 'connected' ? 'online' : connectionState === 'timeout' ? 'timeout' : 'offline';

  // 任务 = current_action；状态 = navigation_status
  const taskText = navState?.task || 'IDLE';
  const statusText = navState?.status || 'IDLE';
  const localized = Boolean(navState?.localized);
  const fitness = Number(navState?.loc_fitness);
  // 未定位时不展示旧坐标，避免建图/丢定位阶段误导
  const posText = localized
    ? `${fmt(pose.x)}, ${fmt(pose.y)}`
    : '--';
  const yawText = localized ? fmt(pose.yaw) : '--';

  return (
    <div className="map-nav-status-bar" aria-label="导航状态">
      <div className="map-nav-status-item">
        <span className="label">链路</span>
        <span className={`value ${stateClass}`}>{stateText}</span>
      </div>
      <div className="map-nav-status-item">
        <span className="label">地图</span>
        <span className="value accent">{navState?.map_name || '未加载'}</span>
      </div>
      <div className="map-nav-status-item">
        <span className="label">任务</span>
        <span className="value">{taskText}</span>
      </div>
      <div className="map-nav-status-item">
        <span className="label">状态</span>
        <span className="value">{statusText}</span>
      </div>
      <div className="map-nav-status-item">
        <span className="label">定位</span>
        <span className={`value ${localized ? 'online' : 'offline'}`}>
          {localized ? '正常' : '异常'}
          {Number.isFinite(fitness) ? ` (${fmt(fitness, 2)})` : ''}
        </span>
      </div>
      <div className="map-nav-status-item">
        <span className="label">位置</span>
        <span className="value">{posText}</span>
      </div>
      <div className="map-nav-status-item">
        <span className="label">朝向</span>
        <span className="value">{yawText}</span>
      </div>
      <div className="map-nav-status-item">
        <span className="label">速度</span>
        <span className="value">
          {/* 线速度 = Vector3 x/y 模长；角速度 = z */}
          v={fmt(twist.linear)} ω={fmt(twist.angular)}
        </span>
      </div>
    </div>
  );
};

export default NavStatusBar;
