/**
 * 导航模块常量：状态枚举与默认 nav_state（与后续后端 mock 字段对齐）
 */

// 机器人导航状态（与 NaviStatus 枚举对齐；demo 可额外用 PAUSED 等）
export const NAV_STATUS = {
  IDLE: 'IDLE',
  PLANNING: 'PLANNING',
  EXECUTING: 'EXECUTING',
  REACHED: 'REACHED',
  FAILED: 'FAILED',
  EMERGENCY: 'EMERGENCY',
  MAPPING: 'MAPPING',
  LOC_FAILED: 'LOC_FAILED',
  // demo 兼容
  NAVIGATING: 'NAVIGATING',
  RELOCALIZING: 'RELOCALIZING',
  PAUSED: 'PAUSED',
  RESUMING: 'RESUMING',
};

// 二级侧栏面板（地图管理优先）
export const SUB_PANELS = {
  MAP_MANAGE: 'map-manage',
  NAV_CONTROL: 'nav-control',
};

// 地图来源标签
export const MAP_SOURCE = {
  DEMO: 'demo',
  OFFLINE: 'offline',
  ONLINE: 'online',
};

// 建图收尾失败原因 → 弹窗文案
export const MAPPING_ABORT_REASON_TEXT = {
  user_stop: '地图未落盘',
  auto_stop: '地图未落盘',
  finalize: '地图未落盘',
};

/** 生成「建图失败：…」弹窗文案（硬结束未落盘等） */
export function formatMappingFailAlert(abortReason, mapName) {
  const reasonText =
    MAPPING_ABORT_REASON_TEXT[abortReason] ||
    (abortReason ? String(abortReason) : '地图未落盘');
  const name = mapName ? `（${mapName}）` : '';
  return `建图失败：${reasonText}${name}`;
}

// 前端默认导航状态（未连上 / 未收到数据时展示）
export const DEFAULT_NAV_STATE = {
  map_name: '未加载地图',
  // task ← current_action；status ← navigation_status
  task: 'IDLE',
  status: 'IDLE',
  route_paused: false,
  loaded_map_id: '',
  localized: false,
  loc_fitness: 0,
  distance_to_goal: 0,
  mapping: {
    active: false,
    name: '',
    phase: 'idle',
    revision: 0,
    has_image: false,
    resolution: 0.05,
    origin_x: 0,
    origin_y: 0,
    width: 0,
    height: 0,
    image_url: '',
    load_error: '',
    abort_reason: '',
  },
  active_route_id: '',
  current_waypoint_id: '',
  pose: { x: 0, y: 0, z: 0, roll: 0, pitch: 0, yaw: 0 },
  twist: { linear: 0, angular: 0 },
};
