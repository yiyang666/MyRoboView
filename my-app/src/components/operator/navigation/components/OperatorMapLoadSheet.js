import React from 'react';

/**
 * 地图加载抽屉：仅切换加载，不含删改与资源编辑
 */
export default function OperatorMapLoadSheet({
  maps = [],
  loadedMapId = '',
  loadingMaps = false,
  mutating = false,
  error = '',
  disabled = false,
  onLoadMap,
}) {
  return (
    <div>
      <p className="operator-sheet-desc">选择一张离线地图加载到机器人。目标点与线路请在桌面监控台配置。</p>
      {error ? (
        <p className="map-nav-inline-error" role="alert">
          {error}
        </p>
      ) : null}
      {loadingMaps ? <p className="operator-sheet-desc">正在刷新地图列表…</p> : null}
      <div className="operator-map-list">
        {maps.length === 0 && !loadingMaps ? (
          <p className="operator-sheet-desc">暂无可用地图</p>
        ) : null}
        {maps.map((map) => {
          const isLoaded = map.id === loadedMapId;
          return (
            <div
              key={map.id}
              className={`operator-map-item ${isLoaded ? 'is-loaded' : ''}`}
            >
              <div>
                <div className="operator-map-item__name">{map.name || map.id}</div>
                <div className="operator-map-item__meta">
                  {isLoaded ? '当前已加载' : map.source || 'offline'}
                </div>
              </div>
              <button
                type="button"
                className="operator-map-item__load"
                disabled={disabled || mutating || isLoaded}
                onClick={() => onLoadMap?.(map.id)}
              >
                {isLoaded ? '已加载' : '加载'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
