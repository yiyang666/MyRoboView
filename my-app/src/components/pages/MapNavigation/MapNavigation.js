import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './MapNavigation.css';
import { SUB_PANELS, formatMappingFailAlert, isNavDomainTaskBusy } from './constants';
import { useMapResources } from './hooks/useMapResources';
import { useNavState } from './hooks/useNavState';
import { apiFetch } from '../../../utils/apiClient';
import NavSubSidebar from './components/NavSubSidebar';
import NavStatusBar from './components/NavStatusBar';
import MapCanvas from './components/MapCanvas';
import MappingCard from './components/MappingCard';
import NavTaskCard from './components/NavTaskCard';
import MapManagePanel from './components/MapManagePanel';

/**
 * 地图导航模块壳：二级侧栏 + 状态条 + 2D 地图 + 后端 nav_state 订阅
 * 统一管理地图选点模式（目标点 / 手动重定位 / 快速导航）
 */
const MapNavigation = ({ sendMessage, addMessageHandler, connected, robotStatus }) => {
  const [activePanel, setActivePanel] = useState(SUB_PANELS.MAP_MANAGE);
  const [selectedRouteId, setSelectedRouteId] = useState('');
  // pickMode: null | 'waypoint' | 'manual_reloc' | 'quick_nav'
  const [pickMode, setPickMode] = useState(null);
  const [draftPose, setDraftPose] = useState(null);
  const [manualRelocLoading, setManualRelocLoading] = useState(false);
  const wasMappingRef = useRef(false);
  // 本页会话内见过建图；用于失败弹窗，避免残留 abort_reason 在刷新后误弹
  const sawMappingSessionRef = useRef(false);
  const failAlertedRef = useRef(false);

  const { navState, poseRef, globalPathRef, localPathRef, connectionState } = useNavState({
    sendMessage,
    addMessageHandler,
    connected,
  });
  const {
    maps,
    loadedMapId,
    loadedMapName,
    activeMap,
    waypoints,
    routes,
    loadingMaps,
    loadingResources,
    mutating,
    error,
    loadMap,
    deleteMap,
    createWaypoint,
    deleteWaypoint,
    createRoute,
    deleteRoute,
    startRouteTask,
    pauseRouteTask,
    resumeRouteTask,
    stopRouteTask,
    startPointTask,
    refreshMaps,
    refreshCurrentResources,
  } = useMapResources();

  // 与后端 canStartNavigation 一致：运控 current_state 须为 RUNNING
  const robotRunning = robotStatus?.status === 'RUNNING';

  const mapping = navState?.mapping;
  // 建图模式以状态机 task=MAP_BUILD 为准；mapping.active 为后端预览对齐态
  const mappingActive =
    navState?.task === 'MAP_BUILD' || Boolean(mapping?.active);
  // 与后端 isNavDomainTaskBusy 对齐：启动建图/导航互斥
  const navDomainBusy = isNavDomainTaskBusy(navState);

  // 建图中：用内存预览图；否则用已加载地图
  const canvasMap = useMemo(() => {
    if (mappingActive && mapping?.phase === 'streaming' && mapping.has_image) {
      return {
        id: '__mapping__',
        name: mapping.name || '建图中',
        imageUrl: `${mapping.image_url || '/api/v1/nav/maps/mapping/image'}?v=${mapping.revision || 0}`,
        source: 'online',
        resolution: mapping.resolution || 0.05,
        originX: mapping.origin_x || 0,
        originY: mapping.origin_y || 0,
        width: mapping.width || 0,
        height: mapping.height || 0,
        wallThickness: 0.2,
      };
    }
    if (mappingActive) return null;
    return activeMap;
  }, [mappingActive, mapping, activeMap]);

  // 状态条地图名优先用后端下发；未收到时用当前选择兜底
  const displayNavState = useMemo(
    () => ({
      ...navState,
      map_name: navState.map_name || loadedMapName || '',
    }),
    [navState, loadedMapName]
  );

  const routeLookup = useMemo(
    () => Object.fromEntries(routes.map((route) => [route.id, route])),
    [routes]
  );

  const highlightedRouteId = displayNavState.active_route_id || selectedRouteId || '';
  const highlightedRoute = routeLookup[highlightedRouteId] || null;

  const clearPick = useCallback(() => {
    setPickMode(null);
    setDraftPose(null);
  }, []);

  const startWaypointPick = useCallback(() => {
    if (mappingActive) return;
    setPickMode('waypoint');
    setDraftPose(null);
  }, [mappingActive]);

  const startManualRelocalize = useCallback(() => {
    // 有任务时禁止；硬门禁在 /relocalize/manual（不看 RUNNING）
    if (navDomainBusy) return;
    setPickMode('manual_reloc');
    setDraftPose(null);
  }, [navDomainBusy]);

  // 切换侧栏时退出选点，避免跨面板残留
  const handlePanelChange = useCallback(
    (panel) => {
      clearPick();
      setActivePanel(panel);
    },
    [clearPick]
  );

  // 建图开始（边沿）：切到导航控制并退出选点；结束：刷新列表
  useEffect(() => {
    if (mappingActive) {
      if (!wasMappingRef.current) {
        wasMappingRef.current = true;
        sawMappingSessionRef.current = true;
        failAlertedRef.current = false;
        clearPick();
        setActivePanel(SUB_PANELS.NAV_CONTROL);
      }
      return;
    }
    if (wasMappingRef.current) {
      wasMappingRef.current = false;
      refreshMaps();
      refreshCurrentResources();
    }
  }, [mappingActive, clearPick, refreshMaps, refreshCurrentResources]);

  // 后端按 LrsState.current_map 自动切换已加载图时，刷新列表与当前资源
  useEffect(() => {
    if (mappingActive) return;
    const id = navState?.loaded_map_id || '';
    if (!id || id === loadedMapId) return;
    refreshMaps();
    refreshCurrentResources();
  }, [
    mappingActive,
    navState?.loaded_map_id,
    loadedMapId,
    refreshMaps,
    refreshCurrentResources,
  ]);

  // 建图硬失败弹窗：等最终态（abort_reason + load_error）到齐再弹，避免双广播竞态
  // （手动 STOP / 状态机离开 MAP_BUILD 未落盘等；等首帧不限时）
  useEffect(() => {
    if (mappingActive) return;
    if (!sawMappingSessionRef.current) return;
    const abortReason = mapping?.abort_reason || '';
    const loadError = mapping?.load_error || '';
    // 失败最终态：两者同时有值
    if (abortReason && loadError) {
      if (failAlertedRef.current) return;
      failAlertedRef.current = true;
      sawMappingSessionRef.current = false;
      window.alert(formatMappingFailAlert(abortReason, loadError));
      return;
    }
    // 成功最终态：无错误且已加载地图；中间态（扫盘中）二者皆空且无图 → 继续等待
    if (!abortReason && !loadError && navState.loaded_map_id) {
      sawMappingSessionRef.current = false;
    }
  }, [
    mappingActive,
    mapping?.abort_reason,
    mapping?.load_error,
    navState.loaded_map_id,
  ]);

  useEffect(() => {
    if (!selectedRouteId && routes.length > 0) {
      setSelectedRouteId(routes[0].id);
      return;
    }
    if (!selectedRouteId) return;
    if (!routeLookup[selectedRouteId]) {
      setSelectedRouteId('');
    }
  }, [routeLookup, routes, selectedRouteId]);

  const startQuickNavPick = useCallback(() => {
    // 软门禁：与卡片一致（含 LOCALIZATION）；硬门禁在 point/start
    if (mappingActive || navDomainBusy || !navState?.localized || !robotRunning) {
      return;
    }
    setPickMode('quick_nav');
    setDraftPose(null);
  }, [mappingActive, navDomainBusy, navState?.localized, robotRunning]);

  const confirmManualRelocalize = useCallback(
    async (pose) => {
      if (!pose || manualRelocLoading) return;
      setManualRelocLoading(true);
      try {
        const resp = await apiFetch('/api/v1/nav/relocalize/manual', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // 真实地图坐标 + 朝向；后端拼成 LOC param=x,y,yaw
          body: JSON.stringify({
            x: pose.x,
            y: pose.y,
            yaw: pose.yaw,
          }),
        });
        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          console.warn('[MapNavigation] manual reloc failed:', data?.error || resp.status);
        } else {
          clearPick();
        }
      } catch (err) {
        console.warn('[MapNavigation] manual reloc error:', err);
      } finally {
        setManualRelocLoading(false);
      }
    },
    [clearPick, manualRelocLoading]
  );

  const handlePickConfirm = useCallback(
    async (pose) => {
      if (!pose) return;
      if (pickMode === 'manual_reloc') {
        // 选点期间若任务已占用，不再下发
        if (navDomainBusy) return;
        await confirmManualRelocalize(pose);
        return;
      }
      if (mappingActive) return;
      if (pickMode === 'quick_nav') {
        if (navDomainBusy || !navState?.localized || !robotRunning) return;
        const ok = await startPointTask({
          x: pose.x,
          y: pose.y,
          yaw: pose.yaw,
        });
        if (ok) clearPick();
      }
    },
    [
      pickMode,
      mappingActive,
      navDomainBusy,
      navState?.localized,
      robotRunning,
      confirmManualRelocalize,
      startPointTask,
      clearPick,
    ]
  );

  const mappingWaiting = mappingActive && mapping?.phase !== 'streaming';
  const canvasEmptyHint = mappingWaiting
    ? `正在等待地图数据…${mapping?.name ? `（${mapping.name}）` : ''}`
    : undefined;

  // 地图资源面板共用 props；子栏通过 show* 控制卡片归属
  const mapResourceProps = {
    maps,
    loadedMapId,
    activeMap,
    waypoints,
    routes,
    loadingMaps,
    loadingResources,
    mutating: mutating || mappingActive,
    error: mappingActive ? '建图进行中，暂不支持地图管理' : error,
    poseRef,
    pickMode,
    draftPose,
    onStartWaypointPick: startWaypointPick,
    onCancelPick: clearPick,
    onLoadMap: mappingActive ? undefined : loadMap,
    onDeleteMap: mappingActive ? undefined : deleteMap,
    onCreateWaypoint: mappingActive ? undefined : createWaypoint,
    onDeleteWaypoint: mappingActive ? undefined : deleteWaypoint,
    onCreateRoute: mappingActive ? undefined : createRoute,
    onDeleteRoute: mappingActive ? undefined : deleteRoute,
  };

  return (
    <div className="map-nav-root">
      <NavSubSidebar activePanel={activePanel} onPanelChange={handlePanelChange}>
        {activePanel === SUB_PANELS.MAP_MANAGE ? (
          <>
            <MappingCard
              connected={connected}
              connectionState={connectionState}
              hasLoadedMap={Boolean(activeMap)}
              pickMode={pickMode}
              mappingActive={mappingActive}
              navDomainBusy={navDomainBusy}
              robotRunning={robotRunning}
              onStartManualRelocalize={startManualRelocalize}
              onCancelPick={clearPick}
            />
            <MapManagePanel
              {...mapResourceProps}
              showMapLoad
              showWaypoints={false}
              showRoutes={false}
            />
          </>
        ) : (
          <>
            <MapManagePanel
              {...mapResourceProps}
              showMapLoad={false}
              showWaypoints
              showRoutes
            />
            <NavTaskCard
              hasLoadedMap={Boolean(activeMap) && !mappingActive}
              waypoints={waypoints}
              routes={routes}
              selectedRouteId={selectedRouteId}
              navState={displayNavState}
              robotRunning={robotRunning}
              navDomainBusy={navDomainBusy}
              pickingQuickNav={pickMode === 'quick_nav'}
              disabled={
                mutating ||
                loadingResources ||
                (Boolean(pickMode) && pickMode !== 'quick_nav') ||
                mappingActive
              }
              onSelectRoute={setSelectedRouteId}
              onStartRoute={() => startRouteTask(selectedRouteId)}
              onStartQuickNav={startQuickNavPick}
              onCancelQuickNav={clearPick}
              onPauseRoute={pauseRouteTask}
              onResumeRoute={resumeRouteTask}
              onStopRoute={stopRouteTask}
            />
          </>
        )}
      </NavSubSidebar>

      <div className="map-nav-main">
        <div className="map-nav-map-stage">
          <MapCanvas
            map={canvasMap}
            emptyHint={canvasEmptyHint}
            poseRef={poseRef}
            globalPathRef={globalPathRef}
            localPathRef={localPathRef}
            waypoints={mappingActive ? [] : waypoints}
            routes={mappingActive ? [] : routes}
            highlightedRouteId={mappingActive ? '' : highlightedRoute?.id || ''}
            pickMode={mappingActive ? null : pickMode}
            draftPose={draftPose}
            onDraftPoseChange={setDraftPose}
            onPickConfirm={handlePickConfirm}
            onPickCancel={clearPick}
          />
          <NavStatusBar navState={displayNavState} connectionState={connectionState} />
        </div>
      </div>
    </div>
  );
};

export default MapNavigation;
