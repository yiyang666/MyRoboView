import React from 'react';

/**
 * 导航任务卡片：
 * - 选择线路后 START / PAUSE / RESUME / STOP
 * - demo 地图走后端 mock；离线地图发真实 NAV 话题
 */
const NavTaskCard = ({
  hasLoadedMap,
  mapSource = 'demo',
  waypoints = [],
  routes = [],
  selectedRouteId = '',
  navState = {},
  disabled = false,
  onSelectRoute,
  onStartRoute,
  onPauseRoute,
  onResumeRoute,
  onStopRoute,
}) => {
  const routeCount = routes.length;
  const running = Boolean(navState?.active_route_id);
  // 暂停：系统 running_status=PAUSED，或本地线路暂停标记（下发后即时反馈）
  const paused =
    navState?.status === 'PAUSED' || Boolean(navState?.route_paused);
  const canStart = hasLoadedMap && selectedRouteId && !running && !disabled;
  const canPause = running && !paused && !disabled;
  const canResume = running && paused && !disabled;
  const canStop = running && !disabled;

  const sourceHint = '开始任务会发布导航指令，同时由后端模拟沿线路移动。';

  return (
    <div className="map-nav-card">
      <h3>导航任务</h3>
      <p>{sourceHint}</p>
      <label className="map-nav-form-field">
        <span>导航线路</span>
        <select
          className="map-nav-select"
          value={selectedRouteId}
          onChange={(e) => onSelectRoute?.(e.target.value)}
          disabled={!hasLoadedMap || routeCount === 0 || disabled || running}
        >
          <option value="">请选择线路</option>
          {routes.map((route) => (
            <option key={route.id} value={route.id}>
              {route.name}
            </option>
          ))}
        </select>
      </label>
      <div className="map-nav-card-actions">
        <button
          type="button"
          className="map-nav-btn primary"
          disabled={!canStart}
          onClick={() => onStartRoute?.()}
        >
          开始任务
        </button>
        <button
          type="button"
          className="map-nav-btn muted"
          disabled={!canPause}
          onClick={() => onPauseRoute?.()}
        >
          暂停任务
        </button>
        <button
          type="button"
          className="map-nav-btn muted"
          disabled={!canResume}
          onClick={() => onResumeRoute?.()}
        >
          恢复任务
        </button>
        <button
          type="button"
          className="map-nav-btn muted"
          disabled={!canStop}
          onClick={() => onStopRoute?.()}
        >
          终止任务
        </button>
      </div>
      <div className="map-nav-resource-summary">
        <span>当前地图：{hasLoadedMap ? '已加载' : '未加载'}</span>
        <span>来源：{mapSource || '-'}</span>
        <span>目标点：{waypoints.length}</span>
        <span>线路：{routeCount}</span>
        <span>执行中：{running ? (paused ? '暂停' : '是') : '否'}</span>
      </div>
    </div>
  );
};

export default NavTaskCard;
