/**
 * 控制能力适配层。
 *
 * 页面层仍从这个文件取数据，避免直接耦合到产品配置目录；
 * 真正的产品差异由 src/config/controlCatalog.js 统一选择。
 */
import { CONTROL_CATALOG } from '../../../config/controlCatalog';

export const SECTION_HOTKEY_HINTS = CONTROL_CATALOG.sectionHotkeyHints;
export const SOFT_ESTOP = CONTROL_CATALOG.softEStop;
export const ROBOT_STATES = CONTROL_CATALOG.states;
export const ROBOT_MODES = CONTROL_CATALOG.modes;
export const ROBOT_ACTIONS = CONTROL_CATALOG.actions;
export const DANCE_ACTIONS = CONTROL_CATALOG.danceActions;
export const VOICE_PRESETS = CONTROL_CATALOG.voicePresets;
