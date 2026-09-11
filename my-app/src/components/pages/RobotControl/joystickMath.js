import { RELEASE_MODES } from './keyboardRampConfig';

export const joyEqual = (a, b) => a.x === b.x && a.y === b.y;

export const targetMoveX = (keys) => {
  const w = keys.has('KeyW');
  const s = keys.has('KeyS');
  if (w && !s) return 1;
  if (s && !w) return -1;
  return 0;
};

export const targetMoveY = (keys) => {
  const a = keys.has('KeyA');
  const d = keys.has('KeyD');
  if (a && !d) return 1;
  if (d && !a) return -1;
  return 0;
};

export const computeTurnJoy = (keys) => {
  const left = keys.has('ArrowLeft');
  const right = keys.has('ArrowRight');
  return {
    x: 0,
    y: left && !right ? 1 : right && !left ? -1 : 0,
  };
};

const approachMoveAxis = (current, target, dtSec, { rampUpRate, rampDownRate }) => {
  if (Math.abs(target - current) < 1e-4) return target;

  let effectiveTarget = target;
  if (
    Math.abs(current) > 1e-4 &&
    Math.abs(target) > 1e-4 &&
    Math.sign(current) !== Math.sign(target)
  ) {
    effectiveTarget = 0;
  }

  const rate =
    effectiveTarget === 0 || Math.abs(effectiveTarget) < Math.abs(current)
      ? rampDownRate
      : rampUpRate;

  const step = rate * dtSec;
  const delta = effectiveTarget - current;
  if (Math.abs(delta) <= step) return effectiveTarget;
  return current + Math.sign(delta) * step;
};

export const rampMoveAxis = (current, target, dtSec, axisConfig) => {
  if (!axisConfig?.enabled) return target;
  if (target === 0 && axisConfig.releaseMode === RELEASE_MODES.INSTANT) {
    return 0;
  }
  const next = approachMoveAxis(current, target, dtSec, axisConfig);
  return Math.max(-1, Math.min(1, Math.round(next * 10000) / 10000));
};

export const pointerToJoystick = (e, circleRef) => {
  if (!circleRef?.current) return null;
  const rect = circleRef.current.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const offsetX = e.clientX - centerX;
  const offsetY = e.clientY - centerY;
  const distance = Math.sqrt(offsetX * offsetX + offsetY * offsetY);
  const maxRadius = Math.min(rect.width, rect.height) / 2 - 20;

  if (maxRadius <= 0) return null;

  // 手指移出摇杆边界时仍保持跟踪，并把输出夹紧在单位圆内
  const scale = distance > maxRadius ? maxRadius / distance : 1;
  return {
    x: -((offsetY * scale) / maxRadius),
    y: -((offsetX * scale) / maxRadius),
  };
};

export const joystickToSvg = (value, radius = 80) => ({
  cx: 100 - value.y * radius,
  cy: 100 - value.x * radius,
});
