/**
 * LRD-W 控制能力表。
 *
 * 当前约束：
 * - 无语音模块，因此语音卡片与语音快捷键都不暴露
 * - 现阶段没有专属动作，因此动作卡片先隐藏；后续补动作时只改这里
 * - DANCE MODE 先保留为预留模式；舞蹈动作列表为空时不渲染舞蹈卡
 */
export const CONTROL_CATALOG = {
  sectionHotkeyHints: {
    state: '切换状态：Alt+1~4，软急停：P',
    mode: '（暂无快捷键）',
    action: '',
    voice: '',
    dance: '（暂无快捷键）',
    script: '（暂无快捷键）',
  },
  softEStop: {
    id: 'DAMPING_FORCE',
    label: '软急停',
    api: { cmd: 'set_state', state: 'DAMPING_FORCE' },
    danger: true,
    hotkeyHint: 'P',
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
  actions: [],
  danceActions: [],
  voicePresets: [],
};
