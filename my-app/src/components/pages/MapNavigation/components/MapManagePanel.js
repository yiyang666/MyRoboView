import React, { useEffect, useMemo, useState } from 'react';
import { getStoredToken } from '../../../../utils/apiClient';

/** 标题旁小图标按钮 */
const IconBtn = ({ title, disabled, active, onClick, children }) => (
  <button
    type="button"
    className={`map-nav-icon-btn ${active ? 'is-active' : ''}`}
    title={title}
    disabled={disabled}
    onClick={(e) => {
      e.stopPropagation();
      onClick?.(e);
    }}
  >
    {children}
  </button>
);

/**
 * 地图资源面板（可按子栏拆分展示）：
 * - 地图加载：默认只展示已加载地图，其他地图折叠
 * - 目标点：+ 展开表单；定位图标取当前位姿；铅笔图标地图选点
 * - 线路列表默认折叠，勾选目标点 + 拖拽排序
 */
const MapManagePanel = ({
  maps,
  loadedMapId,
  activeMap,
  waypoints,
  routes,
  loadingMaps,
  loadingResources,
  mutating,
  error,
  poseRef,
  pickMode,
  draftPose,
  onStartWaypointPick,
  onCancelPick,
  onLoadMap,
  onDeleteMap,
  onCreateWaypoint,
  onDeleteWaypoint,
  onCreateRoute,
  onDeleteRoute,
  // 控制卡片归属：地图管理子栏只显示地图加载，导航控制子栏显示目标点/线路
  showMapLoad = true,
  showWaypoints = true,
  showRoutes = true,
}) => {
  const [waypointForm, setWaypointForm] = useState({
    name: '',
    x: '0',
    y: '0',
    yaw: '0',
    description: '',
  });
  const [routeForm, setRouteForm] = useState({
    name: '',
    description: '',
    waypointIds: [],
  });
  // 卡片折叠：目标点 / 线路默认收起
  const [waypointsExpanded, setWaypointsExpanded] = useState(false);
  const [routesExpanded, setRoutesExpanded] = useState(false);
  // 新增目标点表单默认折叠，点 + 才展开
  const [waypointFormOpen, setWaypointFormOpen] = useState(false);
  // 其他地图默认折叠，只显示当前已加载
  const [otherMapsExpanded, setOtherMapsExpanded] = useState(false);
  const [dragWaypointId, setDragWaypointId] = useState('');

  const canEditMapResources = Boolean(activeMap);
  const pickingWaypoint = pickMode === 'waypoint';

  const waypointById = useMemo(
    () => Object.fromEntries(waypoints.map((waypoint) => [waypoint.id, waypoint])),
    [waypoints]
  );

  const loadedMap = useMemo(
    () => maps.find((map) => map.id === loadedMapId) || null,
    [maps, loadedMapId]
  );
  const otherMaps = useMemo(
    () => maps.filter((map) => map.id !== loadedMapId),
    [maps, loadedMapId]
  );

  // 地图选点草稿自动填入表单坐标与方向
  useEffect(() => {
    if (!pickingWaypoint || !draftPose) return;
    setWaypointForm((prev) => ({
      ...prev,
      x: String(Number(draftPose.x.toFixed(3))),
      y: String(Number(draftPose.y.toFixed(3))),
      yaw: String(Number(draftPose.yaw.toFixed(3))),
    }));
  }, [pickingWaypoint, draftPose]);

  const fillFromCurrentPose = () => {
    const pose = poseRef?.current;
    if (!pose) return;
    setWaypointFormOpen(true);
    setWaypointsExpanded(true);
    setWaypointForm((prev) => ({
      ...prev,
      x: String(Number((pose.x ?? 0).toFixed(3))),
      y: String(Number((pose.y ?? 0).toFixed(3))),
      yaw: String(Number((pose.yaw ?? 0).toFixed(3))),
    }));
  };

  const handleCreateWaypoint = async () => {
    if (!activeMap) return;
    const ok = await onCreateWaypoint({
      map_id: activeMap.id,
      name: waypointForm.name.trim(),
      x: Number(waypointForm.x) || 0,
      y: Number(waypointForm.y) || 0,
      yaw: Number(waypointForm.yaw) || 0,
      description: waypointForm.description.trim(),
    });
    if (ok) {
      setWaypointForm({
        name: '',
        x: '0',
        y: '0',
        yaw: '0',
        description: '',
      });
      setWaypointFormOpen(false);
      setWaypointsExpanded(true);
      if (pickingWaypoint) onCancelPick?.();
    }
  };

  const handleCreateRoute = async () => {
    const ok = await onCreateRoute({
      name: routeForm.name.trim(),
      description: routeForm.description.trim(),
      waypoint_ids: routeForm.waypointIds,
    });
    if (ok) {
      setRouteForm({
        name: '',
        description: '',
        waypointIds: [],
      });
      setRoutesExpanded(true);
    }
  };

  const toggleWaypointInRoute = (waypointId) => {
    setRouteForm((prev) => {
      const exists = prev.waypointIds.includes(waypointId);
      if (exists) {
        return {
          ...prev,
          waypointIds: prev.waypointIds.filter((id) => id !== waypointId),
        };
      }
      return {
        ...prev,
        waypointIds: [...prev.waypointIds, waypointId],
      };
    });
  };

  const moveSelectedWaypoint = (fromIndex, toIndex) => {
    setRouteForm((prev) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= prev.waypointIds.length ||
        toIndex >= prev.waypointIds.length ||
        fromIndex === toIndex
      ) {
        return prev;
      }
      const next = [...prev.waypointIds];
      const [item] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, item);
      return { ...prev, waypointIds: next };
    });
  };

  const renderMapRow = (map) => {
    const isLoaded = map.id === loadedMapId;
    const source = map.source || 'offline';
    const sourceLabel =
      source === 'offline' ? 'offline' : source === 'online' ? 'online' : source;
    return (
      <div
        key={map.id}
        className={`map-nav-list-row map-nav-map-row ${isLoaded ? 'is-loaded' : ''}`}
      >
        <div>
          <div className="map-nav-list-title">
            {map.name}
            <span className={`map-nav-chip map-nav-chip--${sourceLabel}`}>
              {sourceLabel}
            </span>
            {isLoaded ? <span className="map-nav-chip">Loaded</span> : null}
          </div>
          <div className="map-nav-list-meta">
            {map.id} | {Number(map.width).toFixed(1)}m × {Number(map.height).toFixed(1)}m
            {map.resolution ? ` | res ${map.resolution}` : ''}
          </div>
        </div>
        <div className="map-nav-row-actions">
          <button
            type="button"
            className="map-nav-btn primary"
            disabled={mutating || loadingResources || isLoaded}
            onClick={() => onLoadMap(map.id)}
            title="渲染该地图及其目标点、线路"
          >
            加载
          </button>
          <button
            type="button"
            className="map-nav-btn muted"
            disabled={mutating}
            onClick={() => {
              // 新标签打开同源编辑器；token 经 query 传入（sessionStorage 不跨标签共享）
              const token = getStoredToken() || '';
              if (!token) {
                window.alert('未登录或登录已过期，请先登录后再编辑地图');
                return;
              }
              const qs = new URLSearchParams({
                map_id: map.id,
                token,
              });
              window.open(`/map_editor.html?${qs.toString()}`, '_blank');
            }}
            title="在地图编辑器中打开并支持落盘"
          >
            编辑
          </button>
          <button
            type="button"
            className="map-nav-btn muted"
            disabled={mutating || isLoaded}
            onClick={() => {
              if (window.confirm(`确认删除地图「${map.name}」？相关目标点与线路也会一并删除。`)) {
                onDeleteMap(map.id);
              }
            }}
            title={isLoaded ? '不能删除当前已加载的地图' : '删除该地图'}
          >
            删除
          </button>
        </div>
      </div>
    );
  };

  return (
    <div>
      {showMapLoad ? (
      <div className="map-nav-card">
        <h3>地图加载</h3>
        <p>默认只显示当前已加载地图；展开可浏览并切换其他地图。</p>
        {loadingMaps || loadingResources ? (
          <div className="map-nav-inline-note">正在同步地图资源...</div>
        ) : null}
        <div className="map-nav-list">
          {maps.length === 0 ? (
            <div className="map-nav-empty-row">暂无可用地图</div>
          ) : (
            <>
              {loadedMap ? renderMapRow(loadedMap) : (
                <div className="map-nav-empty-row">尚未加载地图，请展开下方列表选择</div>
              )}
              {otherMaps.length > 0 ? (
                <>
                  <button
                    type="button"
                    className="map-nav-maps-fold"
                    onClick={() => setOtherMapsExpanded((prev) => !prev)}
                  >
                    <span>
                      其他地图（{otherMaps.length}）
                    </span>
                    <span className="map-nav-card-chevron">
                      {otherMapsExpanded ? '▾' : '▸'}
                    </span>
                  </button>
                  {otherMapsExpanded ? otherMaps.map(renderMapRow) : null}
                </>
              ) : null}
            </>
          )}
        </div>
      </div>
      ) : null}

      {showWaypoints ? (
      <div className={`map-nav-card ${waypointsExpanded ? 'is-expanded' : 'is-collapsed'}`}>
        <div className="map-nav-card-header-row">
          <h3 className="map-nav-card-inline-title">目标点管理</h3>
          <div className="map-nav-title-icons">
            <IconBtn
              title="新增目标点"
              disabled={!canEditMapResources || mutating}
              active={waypointFormOpen}
              onClick={() => {
                setWaypointsExpanded(true);
                setWaypointFormOpen((prev) => !prev);
              }}
            >
              +
            </IconBtn>
            <IconBtn
              title="用当前定位填写坐标与方向"
              disabled={!canEditMapResources || mutating}
              onClick={fillFromCurrentPose}
            >
              ⌖
            </IconBtn>
            <IconBtn
              title="在地图上选点并拖拽方向"
              disabled={!canEditMapResources || mutating}
              active={pickingWaypoint}
              onClick={() => {
                if (pickingWaypoint) {
                  onCancelPick?.();
                } else {
                  setWaypointsExpanded(true);
                  setWaypointFormOpen(true);
                  onStartWaypointPick?.();
                }
              }}
            >
              ✎
            </IconBtn>
          </div>
          <button
            type="button"
            className="map-nav-card-fold-meta"
            onClick={() => setWaypointsExpanded((prev) => !prev)}
          >
            {waypoints.length} 个
            <span className="map-nav-card-chevron">{waypointsExpanded ? '▾' : '▸'}</span>
          </button>
        </div>
        <p>点「+」展开填写项；「定位」取当前位姿；「铅笔」在地图选点。</p>

        {waypointsExpanded ? (
          <>
            {waypointFormOpen ? (
              <>
                <div className="map-nav-form-grid">
                  <input
                    className="map-nav-input"
                    placeholder="名称"
                    value={waypointForm.name}
                    onChange={(e) =>
                      setWaypointForm((prev) => ({ ...prev, name: e.target.value }))
                    }
                    disabled={!canEditMapResources || mutating}
                  />
                  <input
                    className="map-nav-input"
                    placeholder="X"
                    value={waypointForm.x}
                    onChange={(e) => setWaypointForm((prev) => ({ ...prev, x: e.target.value }))}
                    disabled={!canEditMapResources || mutating}
                  />
                  <input
                    className="map-nav-input"
                    placeholder="Y"
                    value={waypointForm.y}
                    onChange={(e) => setWaypointForm((prev) => ({ ...prev, y: e.target.value }))}
                    disabled={!canEditMapResources || mutating}
                  />
                  <input
                    className="map-nav-input"
                    placeholder="Yaw"
                    value={waypointForm.yaw}
                    onChange={(e) =>
                      setWaypointForm((prev) => ({ ...prev, yaw: e.target.value }))
                    }
                    disabled={!canEditMapResources || mutating}
                  />
                  <input
                    className="map-nav-input map-nav-input--full"
                    placeholder="描述"
                    value={waypointForm.description}
                    onChange={(e) =>
                      setWaypointForm((prev) => ({ ...prev, description: e.target.value }))
                    }
                    disabled={!canEditMapResources || mutating}
                  />
                </div>
                <div className="map-nav-card-actions">
                  <button
                    type="button"
                    className="map-nav-btn primary"
                    disabled={!canEditMapResources || !waypointForm.name.trim() || mutating}
                    onClick={handleCreateWaypoint}
                  >
                    保存目标点
                  </button>
                  <button
                    type="button"
                    className="map-nav-btn muted"
                    disabled={mutating}
                    onClick={() => {
                      setWaypointFormOpen(false);
                      if (pickingWaypoint) onCancelPick?.();
                    }}
                  >
                    收起
                  </button>
                </div>
              </>
            ) : null}
            <div className="map-nav-list">
              {waypoints.length === 0 ? (
                <div className="map-nav-empty-row">当前地图暂无目标点</div>
              ) : (
                waypoints.map((waypoint) => (
                  <div key={waypoint.id} className="map-nav-list-row">
                    <div>
                      <div className="map-nav-list-title">{waypoint.name}</div>
                      <div className="map-nav-list-meta">
                        {waypoint.id} | x={waypoint.x}, y={waypoint.y}, yaw={waypoint.yaw}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="map-nav-btn muted"
                      disabled={mutating}
                      onClick={() => onDeleteWaypoint(waypoint.id)}
                    >
                      删除
                    </button>
                  </div>
                ))
              )}
            </div>
          </>
        ) : null}
      </div>
      ) : null}

      {showRoutes ? (
      <div className={`map-nav-card ${routesExpanded ? 'is-expanded' : 'is-collapsed'}`}>
        <button
          type="button"
          className="map-nav-card-toggle"
          onClick={() => setRoutesExpanded((prev) => !prev)}
        >
          <h3>导航线路管理</h3>
          <span className="map-nav-card-toggle-meta">
            {routes.length} 条
            <span className="map-nav-card-chevron">{routesExpanded ? '▾' : '▸'}</span>
          </span>
        </button>
        <p>勾选目标点加入线路，拖拽已选项调整顺序；序号即导航先后。</p>

        {routesExpanded ? (
          <>
            <div className="map-nav-form-grid">
              <input
                className="map-nav-input"
                placeholder="线路名称"
                value={routeForm.name}
                onChange={(e) => setRouteForm((prev) => ({ ...prev, name: e.target.value }))}
                disabled={!canEditMapResources || mutating}
              />
              <input
                className="map-nav-input map-nav-input--full"
                placeholder="线路描述"
                value={routeForm.description}
                onChange={(e) =>
                  setRouteForm((prev) => ({ ...prev, description: e.target.value }))
                }
                disabled={!canEditMapResources || mutating}
              />
            </div>

            <div className="map-nav-waypoint-picker">
              <div className="map-nav-picker-title">可选目标点（勾选加入）</div>
              {waypoints.length === 0 ? (
                <div className="map-nav-empty-row">暂无目标点可选</div>
              ) : (
                waypoints.map((waypoint) => {
                  const checked = routeForm.waypointIds.includes(waypoint.id);
                  return (
                    <label key={waypoint.id} className="map-nav-check-row">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!canEditMapResources || mutating}
                        onChange={() => toggleWaypointInRoute(waypoint.id)}
                      />
                      <span>
                        {waypoint.name}
                        <em>
                          ({waypoint.x}, {waypoint.y})
                        </em>
                      </span>
                    </label>
                  );
                })
              )}
            </div>

            <div className="map-nav-waypoint-order">
              <div className="map-nav-picker-title">
                已选顺序（拖拽排序）共 {routeForm.waypointIds.length} 个
              </div>
              {routeForm.waypointIds.length === 0 ? (
                <div className="map-nav-empty-row">请先勾选目标点</div>
              ) : (
                routeForm.waypointIds.map((waypointId, index) => {
                  const waypoint = waypointById[waypointId];
                  if (!waypoint) return null;
                  return (
                    <div
                      key={waypointId}
                      className={`map-nav-order-row ${dragWaypointId === waypointId ? 'is-dragging' : ''}`}
                      draggable={canEditMapResources && !mutating}
                      onDragStart={() => setDragWaypointId(waypointId)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        const fromIndex = routeForm.waypointIds.indexOf(dragWaypointId);
                        moveSelectedWaypoint(fromIndex, index);
                        setDragWaypointId('');
                      }}
                      onDragEnd={() => setDragWaypointId('')}
                    >
                      <span className="map-nav-order-index">{index + 1}</span>
                      <span className="map-nav-order-label">
                        {waypoint.name}
                        <em>
                          ({waypoint.x}, {waypoint.y})
                        </em>
                      </span>
                      <span className="map-nav-order-handle" title="拖拽排序">
                        ⋮⋮
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            <div className="map-nav-card-actions">
              <button
                type="button"
                className="map-nav-btn primary"
                disabled={
                  !canEditMapResources ||
                  !routeForm.name.trim() ||
                  routeForm.waypointIds.length === 0 ||
                  mutating
                }
                onClick={handleCreateRoute}
              >
                新增线路
              </button>
            </div>

            <div className="map-nav-list">
              {routes.length === 0 ? (
                <div className="map-nav-empty-row">当前地图暂无线路</div>
              ) : (
                routes.map((route) => (
                  <div key={route.id} className="map-nav-list-row">
                    <div>
                      <div className="map-nav-list-title">{route.name}</div>
                      <div className="map-nav-list-meta">
                        {route.id} | 目标点数 {route.waypoint_ids?.length || 0}
                        {Array.isArray(route.waypoint_ids) && route.waypoint_ids.length > 0
                          ? ` | ${route.waypoint_ids
                              .map((id, idx) => `${idx + 1}.${waypointById[id]?.name || id}`)
                              .join(' → ')}`
                          : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="map-nav-btn muted"
                      disabled={mutating}
                      onClick={() => onDeleteRoute(route.id)}
                    >
                      删除
                    </button>
                  </div>
                ))
              )}
            </div>
          </>
        ) : null}
      </div>
      ) : null}

      {error ? <div className="map-nav-error-banner">{error}</div> : null}
    </div>
  );
};

export default MapManagePanel;
