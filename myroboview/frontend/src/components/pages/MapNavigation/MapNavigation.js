import React, { useEffect, useRef, useState } from 'react';
import { apiJson } from '../../../utils/apiClient';
import { SUB_PANELS } from './constants';
import MapCanvas from './components/MapCanvas';
import NavSubSidebar from './components/NavSubSidebar';
import NavStatusBar from './components/NavStatusBar';
import NavTaskCard from './components/NavTaskCard';
import './MapNavigation.css';

export default function MapNavigation({ navState, connected }) {
  const [panel, setPanel] = useState(SUB_PANELS.MAP_MANAGE);
  const [resources, setResources] = useState(null);
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const [routeName, setRouteName] = useState('新线路');
  const [routePoints, setRoutePoints] = useState([]);
  const [pointName, setPointName] = useState('新目标点');
  const [mapName, setMapName] = useState('demo_map');
  const [pickMode, setPickMode] = useState(null);
  const [draftPose, setDraftPose] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pending = useRef(false);
  const poseRef = useRef(null);
  poseRef.current = connected ? navState?.pose : null;
  const nav = navState || {};
  const waypoints = resources?.waypoints || [], routes = resources?.routes || [];
  const map = resources?.map;
  const canvasMap = map && { ...map, imageUrl: map.image_url, originX: map.origin_x, originY: map.origin_y };
  const disabled = busy || !connected || !navState;
  const active = Boolean(nav.active_route_id || nav.mapping?.active);
  useEffect(() => {
    if (!connected) return;
    let current = true;
    apiJson('/api/v1/nav/maps/current/resources').then(value => {
      if (current) {
        setResources(value); setError(''); setRoutePoints([]);
        setSelectedRouteId(previous => value.routes.some(route => route.id === previous) ? previous : '');
      }
    }).catch(reason => { if (current) setError(reason.message); });
    return () => { current = false; };
  }, [connected]);
  async function action(path, data = {}, method, after) {
    if (pending.current || !connected) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiJson(`/api/v1/nav/${path}`, data, method);
      const updated = await apiJson('/api/v1/nav/maps/current/resources');
      setResources(updated);
      setRoutePoints(previous => previous.filter(id => updated.waypoints.some(point => point.id === id)));
      setNotice(result.published ? '指令已发布，模拟状态已更新' : '已保存');
      after?.(result);
    } catch (reason) { setError(reason.message); }
    finally { pending.current = false; setBusy(false); }
  }
  const beginPick = mode => { setPickMode(mode); setDraftPose(null); };
  const cancelPick = () => { setPickMode(null); setDraftPose(null); };
  function confirmPick(pose) {
    if (disabled || !pose) return;
    if (pickMode === 'manual_reloc') action('localization/manual', pose, undefined, cancelPick);
    else action('waypoints', { ...pose, name: pointName, map_id: map.id }, undefined, cancelPick);
  }
  return <div className="map-nav-root">
    <NavSubSidebar activePanel={panel} onPanelChange={next => { setPanel(next); cancelPick(); }}>
      {panel === SUB_PANELS.MAP_MANAGE ? <>
        <div className="map-nav-card"><h3>地图管理</h3><p>{map?.name || '等待地图…'}</p>
          <button className="map-nav-btn primary" disabled={disabled || active || !map} onClick={() => action('maps/load', { map_id: map.id })}>加载地图</button>
        </div>
        <div className="map-nav-card"><h3>目标点</h3>
          <label className="map-nav-form-field"><span>目标点名称</span><input className="map-nav-input" value={pointName} maxLength={128} onChange={event => setPointName(event.target.value)} /></label>
          <button className="map-nav-btn primary" disabled={disabled || active || !map || !pointName.trim()} onClick={() => beginPick('waypoint')}>地图选点新增</button>
          <div className="map-nav-list">{waypoints.map(point => <div className="map-nav-list-row" key={point.id}>
            <div><strong>{point.name}</strong><div className="map-nav-list-meta">{point.x.toFixed(2)}, {point.y.toFixed(2)} · {point.yaw.toFixed(2)} rad</div></div>
            <button className="map-nav-btn muted" aria-label={`删除目标点 ${point.name}`} disabled={disabled || active} onClick={() => action(`waypoints/${encodeURIComponent(point.id)}`, undefined, 'DELETE')}>删除</button>
          </div>)}</div>
        </div>
        <div className="map-nav-card"><h3>导航线路</h3>
          <label className="map-nav-form-field"><span>线路名称</span><input className="map-nav-input" value={routeName} maxLength={128} onChange={event => setRouteName(event.target.value)} /></label>
          <p>按点击顺序选择目标点：</p>
          {waypoints.map(point => <label className="demo-route-point" key={point.id}><input type="checkbox" checked={routePoints.includes(point.id)} disabled={disabled} onChange={event => setRoutePoints(previous => event.target.checked ? [...previous, point.id] : previous.filter(id => id !== point.id))} />{point.name} {routePoints.includes(point.id) && `(${routePoints.indexOf(point.id) + 1})`}</label>)}
          <button className="map-nav-btn primary" disabled={disabled || !routeName.trim() || !routePoints.length} onClick={() => action('routes', { name: routeName, waypoint_ids: routePoints }, undefined, result => { setSelectedRouteId(result.route.id); setRoutePoints([]); })}>保存线路</button>
          <div className="map-nav-list">{routes.map(route => <div className="map-nav-list-row" key={route.id}><button className={`map-nav-btn ${selectedRouteId === route.id ? 'primary' : 'muted'}`} onClick={() => setSelectedRouteId(route.id)}>{route.name}</button>
            <button className="map-nav-btn muted" aria-label={`删除线路 ${route.name}`} disabled={disabled || nav.active_route_id === route.id} onClick={() => action(`routes/${encodeURIComponent(route.id)}`, undefined, 'DELETE', () => { if (selectedRouteId === route.id) setSelectedRouteId(''); })}>删除</button></div>)}</div>
        </div>
      </> : <>
        <div className="map-nav-card"><h3>建图与定位</h3><p>建图发送指令并切换模拟状态，地图仍使用预置演示图。</p>
          <label className="map-nav-form-field"><span>地图名称</span><input className="map-nav-input" value={mapName} maxLength={128} onChange={event => setMapName(event.target.value)} /></label>
          <div className="map-nav-card-actions">
            <button className="map-nav-btn primary" disabled={disabled || active || !mapName.trim()} onClick={() => action('mapping/start', { map_name: mapName })}>开始建图</button>
            <button className="map-nav-btn muted" disabled={disabled || !nav.mapping?.active} onClick={() => action('mapping/stop')}>结束建图</button>
            <button className="map-nav-btn muted" disabled={disabled || active} onClick={() => action('localization/start')}>主动定位</button>
            <button className="map-nav-btn muted" disabled={disabled || active || !map} onClick={() => beginPick('manual_reloc')}>手动重定位</button>
          </div>
        </div>
        <NavTaskCard hasLoadedMap={Boolean(map)} waypoints={waypoints} routes={routes} selectedRouteId={selectedRouteId} navState={nav}
          disabled={disabled || Boolean(nav.mapping?.active)} onSelectRoute={setSelectedRouteId}
          onStartRoute={() => action('tasks/route/start', { route_id: selectedRouteId })}
          onPauseRoute={() => action('tasks/route/pause')} onResumeRoute={() => action('tasks/route/resume')} onStopRoute={() => action('tasks/route/stop')} />
      </>}
    </NavSubSidebar>
    <div className="map-nav-main">
      {error && <div className="map-nav-error-banner" role="alert">{error}</div>}
      {notice && <div className="demo-nav-notice" role="status">{notice}</div>}
      <div className="map-nav-map-stage">
        <MapCanvas map={canvasMap} poseRef={poseRef} waypoints={waypoints} routes={routes} highlightedRouteId={nav.active_route_id || selectedRouteId}
          pickMode={disabled || active ? null : pickMode} draftPose={draftPose} onDraftPoseChange={setDraftPose} onPickConfirm={confirmPick} onPickCancel={cancelPick} />
        <NavStatusBar navState={nav} connectionState={connected && navState ? 'connected' : 'disconnected'} />
      </div>
    </div>
  </div>;
}
