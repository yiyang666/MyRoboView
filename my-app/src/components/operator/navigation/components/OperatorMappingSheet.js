import React, { useState } from 'react';
import { apiFetch } from '../../../../utils/apiClient';

/**
 * 建图抽屉：开始/结束建图 + 主动重定位（不含手动选点）
 */
export default function OperatorMappingSheet({
  connected,
  connectionState,
  hasLoadedMap,
  mappingActive = false,
}) {
  const [loading, setLoading] = useState(null);
  const [mapName, setMapName] = useState('');
  const [startError, setStartError] = useState('');

  const mappingDisabled = !connected || connectionState !== 'connected';
  const relocDisabled = mappingDisabled || !hasLoadedMap || mappingActive;
  const trimmedMapName = mapName.trim();
  const stopDisabled = !mappingActive || Boolean(loading);
  const startDisabled =
    mappingDisabled || Boolean(loading) || mappingActive || !trimmedMapName;

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
        console.warn('[OperatorMappingSheet]', url, 'failed:', msg);
        if (key === 'start') setStartError(msg);
      } else if (key === 'start') {
        setStartError('');
      }
    } catch (err) {
      console.warn('[OperatorMappingSheet]', url, 'error:', err);
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
    <div>
      <p className="operator-sheet-desc">
        开始建图后实时预览 OccupancyGrid，结束后自动加载落盘同名图。建图进行中其它操作已锁定。
      </p>
      <label className="map-nav-form-field">
        <span>地图名称</span>
        <input
          className="map-nav-input"
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
          disabled={relocDisabled || Boolean(loading)}
          onClick={() => call('active_reloc', '/api/v1/nav/relocalize')}
          title="LOC/START，无坐标参数"
        >
          {loading === 'active_reloc' ? '重定位中…' : '自动重定位'}
        </button>
      </div>
      {mappingActive ? (
        <p className="map-nav-mapping-hint">建图进行中：地图切换与导航任务已禁用。</p>
      ) : null}
    </div>
  );
}
