import { CHORD_BINDINGS, SINGLE_KEY_BINDINGS, ALT_STATE_DIGIT_CODES } from './hotkeyBindings';

export const isEditableTarget = (el) =>
  el &&
  (el.tagName === 'INPUT' ||
    el.tagName === 'SELECT' ||
    el.tagName === 'TEXTAREA' ||
    el.isContentEditable);

const hasBlockingModifiers = (e, requireNoModifiers) => {
  if (!requireNoModifiers) return false;
  return e.ctrlKey || e.altKey || e.metaKey || e.shiftKey;
};

const matchModifier = (binding, event) => {
  const wantsCtrl = Boolean(binding.ctrl);
  const wantsAlt = Boolean(binding.alt);
  if (wantsCtrl !== event.ctrlKey) return false;
  if (wantsAlt !== event.altKey) return false;
  if (!wantsCtrl && !wantsAlt && (event.ctrlKey || event.altKey)) return false;
  return true;
};

const matchChord = (binding, pressedCodes, event) => {
  if (!matchModifier(binding, event)) return false;
  const lastKey = binding.chordKeys[binding.chordKeys.length - 1];
  if (event.code !== lastKey) return false;
  return binding.chordKeys.every((code) => pressedCodes.has(code));
};

const shouldBlockBrowserAltShortcut = (event) =>
  event.altKey && ALT_STATE_DIGIT_CODES.includes(event.code);

/**
 * 创建页面级快捷键监听器（组合键 + 单键）
 * 使用 capture 阶段优先拦截 Alt+数字，避免触发浏览器菜单/标签页快捷键。
 */
export function createControlHotkeyListener({ onCommand, isEnabled }) {
  const pressedCodes = new Set();

  const tryChord = (event) => {
    for (const binding of CHORD_BINDINGS) {
      if (matchChord(binding, pressedCodes, event)) {
        event.preventDefault();
        event.stopPropagation();
        onCommand(binding.command, { source: 'hotkey', bindingId: binding.id });
        return true;
      }
    }
    return false;
  };

  const trySingleKey = (event) => {
    for (const binding of SINGLE_KEY_BINDINGS) {
      if (event.code !== binding.key) continue;
      if (hasBlockingModifiers(event, binding.requireNoModifiers)) continue;
      event.preventDefault();
      event.stopPropagation();
      onCommand(binding.command, { source: 'hotkey', bindingId: binding.id });
      return true;
    }
    return false;
  };

  const onKeyDown = (event) => {
    if (!isEnabled()) return;
    if (isEditableTarget(event.target)) return;
    if (event.repeat) return;

    if (shouldBlockBrowserAltShortcut(event)) {
      event.preventDefault();
      event.stopPropagation();
    }

    pressedCodes.add(event.code);

    if (tryChord(event)) return;
    trySingleKey(event);
  };

  const onKeyUp = (event) => {
    pressedCodes.delete(event.code);
  };

  const onBlur = () => {
    pressedCodes.clear();
  };

  const attach = () => {
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
  };

  const detach = () => {
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('blur', onBlur);
    pressedCodes.clear();
  };

  return { attach, detach, pressedCodes };
}
