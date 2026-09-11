import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_KEYBOARD_RAMP,
  loadKeyboardRampConfig,
  normalizeKeyboardRamp,
  saveKeyboardRampConfig,
} from '../keyboardRampConfig';

export function useKeyboardRampConfig() {
  const [rampConfig, setRampConfigState] = useState(loadKeyboardRampConfig);
  const rampConfigRef = useRef(rampConfig);

  rampConfigRef.current = rampConfig;

  useEffect(() => {
    saveKeyboardRampConfig(rampConfig);
  }, [rampConfig]);

  const setRampConfig = useCallback((updater) => {
    setRampConfigState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      return normalizeKeyboardRamp(next);
    });
  }, []);

  const updateAxis = useCallback((axisId, patch) => {
    setRampConfig((prev) => ({
      ...prev,
      [axisId]: { ...prev[axisId], ...patch },
    }));
  }, [setRampConfig]);

  const resetRampConfig = useCallback(() => {
    setRampConfig(normalizeKeyboardRamp(DEFAULT_KEYBOARD_RAMP));
  }, [setRampConfig]);

  return {
    rampConfig,
    rampConfigRef,
    setRampConfig,
    updateAxis,
    resetRampConfig,
  };
}
