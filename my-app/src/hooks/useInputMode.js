import { useEffect, useState } from 'react';
import { fetchInputModeConfig } from '../components/pages/RobotControl/controlApi';
import {
  INPUT_MODES,
  initialModeFromConfig,
} from '../components/pages/RobotControl/inputModes';

/**
 * App 层遥控输入模式：REST 拉初值，切换成功后由控制页写回同一份 state。
 * 不常驻订阅 control 页，避免无意义的页面订阅。
 */
export function useInputMode() {
  const [inputMode, setInputMode] = useState(INPUT_MODES.IOT);
  const [inputModeReady, setInputModeReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchInputModeConfig();
        if (!data || cancelled) return;
        setInputMode(
          initialModeFromConfig({
            iot_joy_switch: Boolean(data.iot_joy_switch),
            web_joy_switch: Boolean(data.web_joy_switch),
          })
        );
      } catch (err) {
        console.warn('[useInputMode] fetch failed:', err);
      } finally {
        if (!cancelled) setInputModeReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { inputMode, setInputMode, inputModeReady };
}

/** 顶栏展示文案：遥控器 / 网页 */
export function inputModeLabel(inputMode) {
  if (inputMode === INPUT_MODES.WEB) return '网页';
  if (inputMode === INPUT_MODES.IOT) return '遥控器';
  return 'Unknown';
}
