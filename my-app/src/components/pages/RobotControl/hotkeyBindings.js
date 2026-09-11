import {
  ROBOT_STATES,
  ROBOT_ACTIONS,
  VOICE_PRESETS,
  SOFT_ESTOP,
} from './controlCatalog';

/** 状态快捷键：Alt+1~4（需在 hotkeyEngine 中屏蔽浏览器默认行为） */
export const ALT_STATE_DIGIT_CODES = ROBOT_STATES
  .map((state) => state.hotkeyCode)
  .filter(Boolean);

/** 单键即时触发（无修饰键） */
export const SINGLE_KEY_BINDINGS = [
  {
    id: 'soft_estop',
    key: SOFT_ESTOP.hotkeyCode || 'KeyP',
    requireNoModifiers: true,
    command: { type: 'soft_estop', state: SOFT_ESTOP.id },
  },
  // 动作/语音的快捷键直接来自产品能力表，确保按钮文案与真实按键闭环
  ...ROBOT_ACTIONS.filter((action) => action.hotkeyCode).map((action) => ({
    id: `action_${action.id}`,
    key: action.hotkeyCode,
    requireNoModifiers: true,
    command: { type: 'action', action: action.id },
  })),
  ...VOICE_PRESETS.filter((voice) => voice.hotkeyCode).map((voice) => ({
    id: `voice_${voice.id}`,
    key: voice.hotkeyCode,
    requireNoModifiers: true,
    command: { type: 'voice', preset: voice.preset },
  })),
];

/** 组合键：在按下 chordKeys 最后一键时触发（支持 alt 修饰） */
export const CHORD_BINDINGS = [
  ...ROBOT_STATES.filter((state) => state.hotkeyCode).map((s) => ({
    id: `state_${s.id}`,
    alt: true,
    chordKeys: [s.hotkeyCode],
    command: { type: 'state', state: s.id },
  })),
];
