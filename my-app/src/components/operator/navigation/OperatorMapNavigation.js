import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../../pages/MapNavigation/MapNavigation.css';
import './OperatorMapNavigation.css';
import { formatMappingFailAlert } from '../../pages/MapNavigation/constants';
import { useMapResources } from '../../pages/MapNavigation/hooks/useMapResources';
import { useNavState } from '../../pages/MapNavigation/hooks/useNavState';
import MapCanvas from '../../pages/MapNavigation/components/MapCanvas';
import NavStatusBar from '../../pages/MapNavigation/components/NavStatusBar';
import OperatorHeader from '../OperatorHeader';
import OperatorBottomBar from './components/OperatorBottomBar';
import OperatorSheet from './components/OperatorSheet';
import OperatorMappingSheet from './components/OperatorMappingSheet';
import OperatorMapLoadSheet from './components/OperatorMapLoadSheet';
import OperatorNavTaskSheet from './components/OperatorNavTaskSheet';

/** 抽屉类型：建图 / 地图 / 任务 */
const SHEETS = {
  MAPPING: 'mapping',
  MAPS: 'maps',
  TASK: 'task',
};

/**
 * 手机现场导航：主屏全屏地图 + 底部抽屉操作
 * 复用桌面导航 hooks 与 MapCanvas，不含选点与资源编辑
 */
export default function OperatorMapNavigation({
  robotStatus,
  inputMode,
  sendMessage,
  addMessageHandler,
  connected,
}) {
  const [activeSheet, setActiveSheet] = useState(null);
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const wasMappingRef = useRef(false);
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
    startRouteTask,
    stopRouteTask,
    refreshMaps,
    refreshCurrentResources,
  } = useMapResources();

  const mapping = navState?.mapping;
  // 建图模式以状态机 task=MAP_BUILD 为准
  const mappingActive =
    navState?.task === 'MAP_BUILD' || Boolean(mapping?.active);

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

  const toggleSheet = useCallback(
    (sheet) => {
      if (sheet !== SHEETS.MAPPING && mappingActive) return;
      setActiveSheet((prev) => (prev === sheet ? null : sheet));
    },
    [mappingActive]
  );

  const closeSheet = useCallback(() => setActiveSheet(null), []);

  // 进入建图：自动打开建图抽屉；结束建图：刷新列表
  useEffect(() => {
    if (mappingActive) {
      wasMappingRef.current = true;
      sawMappingSessionRef.current = true;
      failAlertedRef.current = false;
      setActiveSheet(SHEETS.MAPPING);
      return;
    }
    if (wasMappingRef.current) {
      wasMappingRef.current = false;
      refreshMaps();
      refreshCurrentResources();
    }
  }, [mappingActive, refreshMaps, refreshCurrentResources]);

  // 后端 current_map 变化时同步资源
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

  // 建图失败弹窗
  useEffect(() => {
    if (mappingActive) return;
    if (!sawMappingSessionRef.current) return;
    const abortReason = mapping?.abort_reason || '';
    const loadError = mapping?.load_error || '';
    if (abortReason && loadError) {
      if (failAlertedRef.current) return;
      failAlertedRef.current = true;
      sawMappingSessionRef.current = false;
      window.alert(formatMappingFailAlert(abortReason, loadError));
      return;
    }
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

  const mappingWaiting = mappingActive && mapping?.phase !== 'streaming';
  const canvasEmptyHint = mappingWaiting
    ? `正在等待地图数据…${mapping?.name ? `（${mapping.name}）` : ''}`
    : undefined;

  const sheetLocked = mutating || loadingResources;

  return (
    <div className="operator-map-nav">
      <OperatorHeader
        robotStatus={robotStatus}
        inputMode={inputMode}
        title="导航模式"
        showBack
      />
      <div className="operator-map-nav__stage">
        <MapCanvas
          map={canvasMap}
          emptyHint={canvasEmptyHint}
          poseRef={poseRef}
          globalPathRef={globalPathRef}
          localPathRef={localPathRef}
          waypoints={mappingActive ? [] : waypoints}
          routes={mappingActive ? [] : routes}
          highlightedRouteId={mappingActive ? '' : highlightedRoute?.id || ''}
          initialZoom={1.2}
        />
        <NavStatusBar navState={displayNavState} connectionState={connectionState} />
      </div>
      <OperatorBottomBar
        activeSheet={activeSheet}
        mappingActive={mappingActive}
        onOpenMapping={() => toggleSheet(SHEETS.MAPPING)}
        onOpenMaps={() => toggleSheet(SHEETS.MAPS)}
        onOpenTask={() => toggleSheet(SHEETS.TASK)}
      />

      <OperatorSheet
        open={activeSheet === SHEETS.MAPPING}
        title="建图与重定位"
        onClose={closeSheet}
      >
        <OperatorMappingSheet
          connected={connected}
          connectionState={connectionState}
          hasLoadedMap={Boolean(activeMap)}
          mappingActive={mappingActive}
        />
      </OperatorSheet>

      <OperatorSheet
        open={activeSheet === SHEETS.MAPS}
        title="切换地图"
        onClose={closeSheet}
      >
        <OperatorMapLoadSheet
          maps={maps}
          loadedMapId={loadedMapId}
          loadingMaps={loadingMaps}
          mutating={mutating}
          error={mappingActive ? '建图进行中，暂不支持切换地图' : error}
          disabled={mappingActive || sheetLocked}
          onLoadMap={loadMap}
        />
      </OperatorSheet>

      <OperatorSheet
        open={activeSheet === SHEETS.TASK}
        title="导航任务"
        onClose={closeSheet}
      >
        <OperatorNavTaskSheet
          hasLoadedMap={Boolean(activeMap) && !mappingActive}
          routes={routes}
          selectedRouteId={selectedRouteId}
          navState={displayNavState}
          disabled={mappingActive || sheetLocked}
          onSelectRoute={setSelectedRouteId}
          onStartRoute={() => startRouteTask(selectedRouteId)}
          onStopRoute={stopRouteTask}
        />
      </OperatorSheet>
    </div>
  );
}
