import React from 'react';
import { SUB_PANELS } from '../constants';

/** 二级侧栏：地图管理（建图/加载）优先，其次导航控制（目标点/线路/任务） */
const NavSubSidebar = ({ activePanel, onPanelChange, children }) => {
  return (
    <aside className="map-nav-sub-sidebar">
      <div className="map-nav-sub-tabs">
        <button
          type="button"
          className={`map-nav-sub-tab ${activePanel === SUB_PANELS.MAP_MANAGE ? 'active' : ''}`}
          onClick={() => onPanelChange(SUB_PANELS.MAP_MANAGE)}
        >
          地图管理
        </button>
        <button
          type="button"
          className={`map-nav-sub-tab ${activePanel === SUB_PANELS.NAV_CONTROL ? 'active' : ''}`}
          onClick={() => onPanelChange(SUB_PANELS.NAV_CONTROL)}
        >
          导航控制
        </button>
      </div>
      <div className="map-nav-sub-body">{children}</div>
    </aside>
  );
};

export default NavSubSidebar;
