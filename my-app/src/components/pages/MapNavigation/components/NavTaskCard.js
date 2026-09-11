import React from 'react';
import { isNavTaskRunning } from '../constants';

/**
 * 导航任务卡片：
 * - 线路任务：选择线路后 START / PAUSE / RESUME / STOP
 * - 快速导航：地图选点单点下发（不落盘，调试用）
 *
 * 软门禁：已加载地图、定位正常、运控 RUNNING、导航域空闲（含 LOCALIZATION）。
 * 硬门禁：后端 canStartNavigation。
 */
const NavTaskCard = ({
  hasLoadedMap,
  waypoints = [],
  routes = [],
  selectedRouteId = '',
  navState = {},
  robotRunning = false,
  navDomainBusy = false,
  disabled = false,
  pickingQuickNav = false,
  onSelectRoute,
  onStartRoute,
  onStartQuickNav,
  onCancelQuickNav,
  onPauseRoute,
  onResumeRoute,
  onStopRoute,
}) => {
  const routeCount = routes.length;
  const running = isNavTaskRunning(navState);
  const localized = Boolean(navState?.localized);
  const locTaskActive = navState?.task === 'LOCALIZATION';
  const quickNavRunning =
    running && navState?.active_task_kind === 'point';
  const routeRunning =
    running && navState?.active_task_kind === 'route';
  const paused =
    navState?.status === 'PAUSED' ||
    Boolean(navState?.route_paused);
  // 域空闲含 LOCALIZATION：定位任务中不可下发建图/导航
  const canIssueNav =
    hasLoadedMap &&
    localized &&
    robotRunning &&
    !navDomainBusy &&
    !running &&
    !disabled;
  const canStartRoute =
    canIssueNav && Boolean(selectedRouteId) && !pickingQuickNav;
  const canPickQuickNav = canIssueNav && !pickingQuickNav;
  const canPause = running && !paused && !disabled;
  const canResume = running && paused && !disabled;
  const canStop = running && !disabled;

  const runningLabel = !running
    ? '否'
    : quickNavRunning
      ? paused
        ? '快速导航（暂停）'
        : '快速导航'
      : paused
        ? '线路（暂停）'
        : '线路';

  return (
    <div className="map-nav-card">
      <h3>导航任务</h3>
      <p>下发 NAV/START 至机器人；线路任务需先配置目标点与线路，快速导航仅用于算法调试。</p>
      <label className="map-nav-form-field">
        <span>导航线路</span>
        <select
          className="map-nav-select"
          value={selectedRouteId}
          onChange={(e) => onSelectRoute?.(e.target.value)}
          disabled={
            !hasLoadedMap ||
            routeCount === 0 ||
            disabled ||
            running ||
            navDomainBusy ||
            pickingQuickNav
          }
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
          disabled={!canStartRoute}
          onClick={() => onStartRoute?.()}
        >
          开始线路任务
        </button>
        <button
          type="button"
          className={`map-nav-btn ${pickingQuickNav ? 'primary' : 'muted'}`}
          disabled={!canPickQuickNav && !pickingQuickNav}
          onClick={() => (pickingQuickNav ? onCancelQuickNav?.() : onStartQuickNav?.())}
        >
          {pickingQuickNav ? '取消选点' : '快速导航'}
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
        <span>运控：{robotRunning ? 'RUNNING' : '非 RUNNING'}</span>
        <span>定位：{localized ? '正常' : '异常'}</span>
        <span>目标点：{waypoints.length}</span>
        <span>线路：{routeCount}</span>
        <span>执行中：{runningLabel}</span>
        {routeRunning && navState?.active_route_id ? (
          <span>线路 ID：{navState.active_route_id}</span>
        ) : null}
      </div>
      {locTaskActive ? (
        <p className="map-nav-mapping-hint">定位任务进行中，无法下发导航任务（含快速导航）。</p>
      ) : null}
      {!locTaskActive && navDomainBusy && !running ? (
        <p className="map-nav-mapping-hint">导航域任务进行中，无法下发新的导航任务。</p>
      ) : null}
      {!navDomainBusy && !robotRunning && hasLoadedMap && !running ? (
        <p className="map-nav-mapping-hint">运控未处于 RUNNING，无法下发导航任务（含快速导航）。</p>
      ) : null}
      {!navDomainBusy &&
      robotRunning &&
      !localized &&
      hasLoadedMap &&
      !running ? (
        <p className="map-nav-mapping-hint">定位异常，无法下发导航任务（含快速导航）。请先完成定位。</p>
      ) : null}
      {pickingQuickNav ? (
        <p className="map-nav-mapping-hint">快速导航：请在地图上点击落点并拖拽选择方向，确认后开始导航。</p>
      ) : null}
    </div>
  );
};

export default NavTaskCard;
