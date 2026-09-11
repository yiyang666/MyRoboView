export const RELEASE_MODES = {
  INSTANT: 'instant',
  RAMP: 'ramp',
};

export const RAMP_AXIS_META = {
  x: { id: 'x', label: 'W/S 前后（X）' },
  y: { id: 'y', label: 'A/D 左右（Y）' },
  turn: { id: 'turn', label: '← → 转向（Y）' },
};

/** 移动轴默认配置 */
export const DEFAULT_X_AXIS_RAMP = {
  enabled: true,
  rampUpRate: 5.0,
  rampDownRate: 5.0,
  releaseMode: RELEASE_MODES.INSTANT,
};
export const DEFAULT_Y_AXIS_RAMP = {
  enabled: false,
  rampUpRate: 5.0,
  rampDownRate: 5.0,
  releaseMode: RELEASE_MODES.INSTANT,
};
export const DEFAULT_TURN_AXIS_RAMP = {
  enabled: true,
  rampUpRate: 3.0,
  rampDownRate: 5.0,
  releaseMode: RELEASE_MODES.INSTANT,
};

export const DEFAULT_KEYBOARD_RAMP = {
  x: { ...DEFAULT_X_AXIS_RAMP },
  y: { ...DEFAULT_Y_AXIS_RAMP },
  turn: { ...DEFAULT_TURN_AXIS_RAMP },
};

const STORAGE_KEY = 'roboview_keyboard_ramp_config';

const clampRate = (value, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(20, Math.max(0.5, n));
};

const normalizeAxis = (axis, fallback) => ({
  enabled: Boolean(axis?.enabled ?? fallback.enabled),
  rampUpRate: clampRate(axis?.rampUpRate, fallback.rampUpRate),
  rampDownRate: clampRate(axis?.rampDownRate, fallback.rampDownRate),
  releaseMode:
    axis?.releaseMode === RELEASE_MODES.RAMP
      ? RELEASE_MODES.RAMP
      : RELEASE_MODES.INSTANT,
});

export const normalizeKeyboardRamp = (raw) => ({
  x: normalizeAxis(raw?.x, DEFAULT_KEYBOARD_RAMP.x),
  y: normalizeAxis(raw?.y, DEFAULT_KEYBOARD_RAMP.y),
  turn: normalizeAxis(raw?.turn, DEFAULT_KEYBOARD_RAMP.turn),
});

export function loadKeyboardRampConfig() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return normalizeKeyboardRamp(DEFAULT_KEYBOARD_RAMP);
    return normalizeKeyboardRamp(JSON.parse(stored));
  } catch {
    return normalizeKeyboardRamp(DEFAULT_KEYBOARD_RAMP);
  }
}

export function saveKeyboardRampConfig(config) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeKeyboardRamp(config)));
  } catch (err) {
    console.warn('[RobotControl] Failed to save ramp config:', err);
  }
}
