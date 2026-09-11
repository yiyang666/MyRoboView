import React, { useState } from 'react';
import { apiFetch } from '../../../../utils/apiClient';

/**
 * 建图卡片（在线建图）：
 * - 开始：MAP/START；域空闲 + 运控 RUNNING（与导航启动共用）
 * - 结束：MAP/STOP（不看 RUNNING）
 * - 重定位：域有任务时禁止；不看运控 RUNNING；手动需已加载地图
 */
const MappingCard = ({
  connected,
  connectionState,
  hasLoadedMap,
  pickMode,
  mappingActive = false,
  navDomainBusy = false,
  robotRunning = false,
  onStartManualRelocalize,
  onCancelPick,
}) => {
  const [loading, setLoading] = useState(null);
  const [mapName, setMapName] = useState('');
  const [startError, setStartError] = useState('');

  const mappingDisabled = !connected || connectionState !== 'connected';
  // 重定位：域空闲 +（手动）有图；不看 RUNNING
  const relocDisabled =
    mappingDisabled ||
    navDomainBusy ||
    !hasLoadedMap ||
    pickMode === 'quick_nav';
  const pickingManual = pickMode === 'manual_reloc';
  const pickingQuickNav = pickMode === 'quick_nav';
  const trimmedMapName = mapName.trim();
  const stopDisabled =
    !mappingActive || Boolean(loading) || pickingManual || pickingQuickNav;
  // 开始建图：域占用 + 非 RUNNING 则软禁用
  const startDisabled =
    mappingDisabled ||
    Boolean(loading) ||
    pickingManual ||
    pickingQuickNav ||
    navDomainBusy ||
    !robotRunning ||
    !trimmedMapName;

  const call = async (key, url, body) => {
    if (loading) return;
    setLoading(key);
    try {
      const opts = { method: 'POST' };
      if (body !== undefined) {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = JSON.stringify(body);
      }
      const resp = await apiFetch(url, opts);
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        const msg = data?.error || `请求失败 (${resp.status})`;
        console.warn('[MappingCard]', url, 'failed:', msg);
        if (key === 'start') setStartError(msg);
      } else if (key === 'start') {
        setStartError('');
      }
    } catch (err) {
      console.warn('[MappingCard]', url, 'error:', err);
      if (key === 'start') setStartError(err?.message || '网络错误');
    } finally {
      setLoading(null);
    }
  };

  const onStartMapping = () => {
    if (!trimmedMapName) {
      setStartError('请先输入地图名称');
      return;
    }
    if (/[\\/,]/.test(trimmedMapName)) {
      setStartError('地图名称不能包含路径分隔符或逗号');
      return;
    }
    setStartError('');
    call('start', '/api/v1/nav/mapping/start', { map_name: trimmedMapName });
  };

  return (
    <div className="map-nav-card">
      <h3>建图</h3>
      <p>
        开始建图下发 MAP/START（param=online,地图名），建图中实时预览 OccupancyGrid，结束后自动加载落盘同名图。
      </p>
      <label className="map-nav-form-field">
        <span>地图名称</span>
        <input
          className="map-nav-input map-nav-input--full"
          type="text"
          value={mapName}
          placeholder="例如 office_floor_1"
          disabled={mappingDisabled || Boolean(loading) || mappingActive}
          onChange={(e) => {
            setMapName(e.target.value);
            if (startError) setStartError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onStartMapping();
            }
          }}
        />
      </label>
      {startError ? (
        <p className="map-nav-inline-error" role="alert">
          {startError}
        </p>
      ) : null}
      <div className="map-nav-card-actions">
        <button
          type="button"
          className="map-nav-btn primary"
          disabled={startDisabled}
          onClick={onStartMapping}
        >
          {loading === 'start' ? '开始中…' : '开始建图'}
        </button>
        <button
          type="button"
          className="map-nav-btn muted"
          disabled={stopDisabled}
          onClick={() => call('stop', '/api/v1/nav/mapping/stop')}
        >
          {loading === 'stop' ? '结束中…' : '结束建图'}
        </button>
        <button
          type="button"
          className="map-nav-btn muted"
          disabled={relocDisabled || Boolean(loading) || pickingManual}
          onClick={() => call('active_reloc', '/api/v1/nav/relocalize')}
          title="LOC/START，无坐标参数；有任务时禁止，不依赖运控 RUNNING"
        >
          {loading === 'active_reloc' ? '重定位中…' : '自动重定位'}
        </button>
        <button
          type="button"
          className={`map-nav-btn ${pickingManual ? 'primary' : 'muted'}`}
          disabled={relocDisabled && !pickingManual}
          onClick={() => {
            if (pickingManual) {
              onCancelPick?.();
            } else {
              onStartManualRelocalize?.();
            }
          }}
          title="地图选点并拖方向后下发；有任务时禁止，不依赖运控 RUNNING"
        >
          {pickingManual ? '取消手动选点' : '手动重定位'}
        </button>
      </div>
      {mappingActive ? (
        <p className="map-nav-mapping-hint">建图进行中：地图管理、导航任务与重定位已禁用。</p>
      ) : null}
      {!mappingActive && !robotRunning && !navDomainBusy ? (
        <p className="map-nav-mapping-hint">运控未处于 RUNNING，无法开始建图（重定位不受影响）。</p>
      ) : null}
      {navDomainBusy && !mappingActive ? (
        <p className="map-nav-mapping-hint">导航域任务进行中（含定位），无法开始建图或重定位。</p>
      ) : null}
    </div>
  );
};

export default MappingCard;
