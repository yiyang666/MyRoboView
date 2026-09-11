export const JOY_ZERO = { x: 0, y: 0 };

export const MOVE_KEYS = new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD']);
export const TURN_KEYS = new Set(['ArrowLeft', 'ArrowRight']);
export const ALL_JOY_KEYS = new Set([...MOVE_KEYS, ...TURN_KEYS]);
