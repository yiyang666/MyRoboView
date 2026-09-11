/**
 * LRS-X 控制能力表。
 *
 * 约定：
 * - 哪些卡片可见、按钮顺序、快捷键映射都在这里定义
 * - 页面层只消费能力表，不再散落产品判断
 */
export const CONTROL_CATALOG = {
  sectionHotkeyHints: {
    state: '切换状态：Alt+1~4，软急停：P（仅网页控制）',
    mode: '（暂无快捷键）',
    action: '1~6（仅网页控制）',
    voice: '7~8（仅网页控制）',
    dance: '（暂无快捷键）',
    script: '（暂无快捷键）',
  },
  softEStop: {
    id: 'DAMPING_FORCE',
    label: '软急停',
    api: { cmd: 'set_state', state: 'DAMPING_FORCE' },
    danger: true,
    hotkeyHint: 'P（仅网页控制）',
    hotkeyCode: 'KeyP',
  },
  states: [
    { id: 'DISABLED', label: 'DISABLED', hotkeyHint: 'Alt+1', hotkeyCode: 'Digit1' },
    { id: 'DAMPING', label: 'DAMPING', hotkeyHint: 'Alt+2', hotkeyCode: 'Digit2' },
    { id: 'READY', label: 'READY', hotkeyHint: 'Alt+3', hotkeyCode: 'Digit3' },
    { id: 'RUNNING', label: 'RUNNING', hotkeyHint: 'Alt+4', hotkeyCode: 'Digit4' },
  ],
  modes: [
    { id: 'DEFAULT', label: 'DEFAULT' },
    { id: 'DANCE', label: 'DANCE MODE' },
  ],
  actions: [
    { id: 'WAVE', label: 'WAVE', hotkeyHint: '1', hotkeyCode: 'Digit1' },
    { id: 'CLASP', label: 'CLASP', hotkeyHint: '2', hotkeyCode: 'Digit2' },
    { id: 'HEART', label: 'HEART', hotkeyHint: '3', hotkeyCode: 'Digit3' },
    { id: 'SHAKE', label: 'SHAKE', hotkeyHint: '4', hotkeyCode: 'Digit4' },
    { id: 'CLAP', label: 'CLAP', hotkeyHint: '5', hotkeyCode: 'Digit5' },
    { id: 'KISS', label: 'KISS', hotkeyHint: '6', hotkeyCode: 'Digit6' },
  ],
  danceActions: [
    {
      id: 'DANCE_1',
      label: 'DANCE 1',
      mode: 'DANCE',
    },
  ],
  voicePresets: [
    { id: 'welcome1', preset: 'welcome1', label: '欢迎词1', hotkeyHint: '7', hotkeyCode: 'Digit7' },
    { id: 'welcome2', preset: 'welcome2', label: '欢迎词2', hotkeyHint: '8', hotkeyCode: 'Digit8' },
  ],
};
