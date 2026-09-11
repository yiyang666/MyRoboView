import React from 'react';
import { isNavTaskRunning } from '../../../pages/MapNavigation/constants';

/**
 * 导航任务抽屉：选择已有线路，开始/终止（不含暂停/恢复；不含快速导航）
 */
export default function OperatorNavTaskSheet({
  hasLoadedMap,
  routes = [],
  selectedRouteId = '',
  navState = {},
  disabled = false,
  onSelectRoute,
  onStartRoute,
  onStopRoute,
}) {
  const routeCount = routes.length;
  const running = isNavTaskRunning(navState);
  const canStart = hasLoadedMap && selectedRouteId && !running && !disabled;
  const canStop = running && !disabled;

  return (
    <div>
      <p className="operator-sheet-desc">
        选择线路后下发 NAV/START；任务结束由机器人导航状态自动解锁。
      </p>
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
          disabled={!canStop}
          onClick={() => onStopRoute?.()}
        >
          终止任务
        </button>
      </div>
      <div className="map-nav-resource-summary">
        <span>当前地图：{hasLoadedMap ? '已加载' : '未加载'}</span>
        <span>线路数：{routeCount}</span>
        <span>执行中：{running ? '是' : '否'}</span>
      </div>
    </div>
  );
}
