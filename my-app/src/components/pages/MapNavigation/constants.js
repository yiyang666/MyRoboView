/**
 * 导航模块常量：状态枚举与默认 nav_state
 */

// 机器人导航状态（与 NaviStatus 枚举对齐）
export const NAV_STATUS = {
  IDLE: 'IDLE',
  PLANNING: 'PLANNING',
  EXECUTING: 'EXECUTING',
  REACHED: 'REACHED',
  FAILED: 'FAILED',
  EMERGENCY: 'EMERGENCY',
  MAPPING: 'MAPPING',
  LOC_FAILED: 'LOC_FAILED',
  PAUSED: 'PAUSED',
};

// 导航任务类型：线路（关联 route/waypoint） vs 快速单点（不落盘）
export const NAV_TASK_KIND = {
  ROUTE: 'route',
  POINT: 'point',
};

// 二级侧栏：地图管理（建图/加载）| 导航控制（目标点/线路/任务）
export const SUB_PANELS = {
  MAP_MANAGE: 'map-manage',
  NAV_CONTROL: 'nav-control',
};

// 地图来源标签
export const MAP_SOURCE = {
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

/** 是否有导航任务在执行（统一 UI 锁，含线路与快速导航） */
export function isNavTaskRunning(navState) {
  return Boolean(navState?.nav_task_active);
}

/**
 * 导航域是否占用（与后端 isNavDomainTaskBusy 对齐）
 * NAVIGATION / MAP_BUILD / LOCALIZATION / 建图预览 / 本端导航会话。
 * 占用时不可启动建图、导航；重定位同样禁止。
 * 运控 RUNNING：建图/导航下发需要；重定位不需要。
 */
export function isNavDomainTaskBusy(navState) {
  const task = navState?.task;
  if (task === 'NAVIGATION' || task === 'MAP_BUILD' || task === 'LOCALIZATION') {
    return true;
  }
  if (navState?.mapping?.active) return true;
  if (navState?.nav_task_active) return true;
  return false;
}

// 前端默认导航状态（未连上 / 未收到数据时展示）
export const DEFAULT_NAV_STATE = {
  map_name: '未加载地图',
  task: 'IDLE',
  status: 'IDLE',
  route_paused: false,
  nav_task_active: false,
  active_task_kind: '',
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
  point_goal: null,
  pose: { x: 0, y: 0, z: 0, roll: 0, pitch: 0, yaw: 0 },
  twist: { linear: 0, angular: 0 },
};
