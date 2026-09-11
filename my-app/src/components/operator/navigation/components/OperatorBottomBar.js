import React from 'react';

/** 底部三入口：建图 / 地图 / 任务 */
export default function OperatorBottomBar({
  activeSheet = null,
  mappingActive = false,
  onOpenMapping,
  onOpenMaps,
  onOpenTask,
}) {
  return (
    <nav className="operator-bottom-bar" aria-label="导航操作">
      <button
        type="button"
        className={`operator-bottom-bar__btn ${activeSheet === 'mapping' ? 'is-active' : ''}`}
        onClick={onOpenMapping}
      >
        建图
      </button>
      <button
        type="button"
        className={`operator-bottom-bar__btn ${activeSheet === 'maps' ? 'is-active' : ''}`}
        disabled={mappingActive}
        onClick={onOpenMaps}
        title={mappingActive ? '建图进行中不可用' : undefined}
      >
        地图
      </button>
      <button
        type="button"
        className={`operator-bottom-bar__btn ${activeSheet === 'task' ? 'is-active' : ''}`}
        disabled={mappingActive}
        onClick={onOpenTask}
        title={mappingActive ? '建图进行中不可用' : undefined}
      >
        任务
      </button>
    </nav>
  );
}
