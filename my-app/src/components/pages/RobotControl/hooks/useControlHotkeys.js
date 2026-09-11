import { useEffect, useRef } from 'react';
import { createControlHotkeyListener } from '../hotkeyEngine';
import { INPUT_MODES } from '../inputModes';

export function useControlHotkeys({ inputMode, onCommand }) {
  const onCommandRef = useRef(onCommand);
  const inputModeRef = useRef(inputMode);

  onCommandRef.current = onCommand;
  inputModeRef.current = inputMode;

  useEffect(() => {
    const listener = createControlHotkeyListener({
      // 网页控制模式下启用快捷键（含键盘移动与功能键）
      isEnabled: () => inputModeRef.current === INPUT_MODES.WEB,
      onCommand: (command, meta) => onCommandRef.current?.(command, meta),
    });
    listener.attach();

    return () => {
      listener.detach();
    };
  }, []);
}
