import { useCallback, useEffect, useState } from 'react';
import {
  postInputMode,
  sendControlCommand,
  postVoicePreset,
  fetchScriptList,
} from '../controlApi';
import { SOFT_ESTOP } from '../controlCatalog';
import { initialModeFromConfig, isWebJoyActive, INPUT_MODES } from '../inputModes';

/**
 * 控制页指令逻辑。
 * inputMode 由 App 层共享：切换成功后写回顶栏；本页挂载期间才订阅 control 收偶发 WS。
 */
export function useControlCommands(
  robotStatus,
  {
    onSoftEstop,
    sendMessage,
    addMessageHandler,
    inputMode: sharedInputMode,
    setInputMode: setSharedInputMode,
    inputModeReady: sharedInputModeReady,
  }
) {
  const [selectedState, setSelectedState] = useState('');
  const [selectedMode, setSelectedMode] = useState('');
  const [selectedAction, setSelectedAction] = useState('');
  const [scriptList, setScriptList] = useState([]);
  const [selectedScript, setSelectedScript] = useState('');
  const [scriptRunning, setScriptRunning] = useState(false);
  const [voiceSending, setVoiceSending] = useState(null);
  // 无 App 共享 state 时的本地兜底（正常路径由 App useInputMode 注入）
  const [localInputMode, setLocalInputMode] = useState(INPUT_MODES.IOT);
  const inputMode =
    sharedInputMode !== undefined ? sharedInputMode : localInputMode;
  const setInputMode = setSharedInputMode || setLocalInputMode;
  const inputModeReady =
    sharedInputModeReady !== undefined ? sharedInputModeReady : true;

  const ensureConnected = useCallback(() => {
    if (!robotStatus?.connected) {
      alert('无法操作：机器人未连接');
      return false;
    }
    return true;
  }, [robotStatus?.connected]);

  const runCommand = useCallback(
    async (cmdType, data, { silent = false } = {}) => {
      if (!ensureConnected()) return false;
      try {
        await sendControlCommand(cmdType, data);
        return true;
      } catch (err) {
        console.error(`[RobotControl] ${cmdType} error:`, err);
        if (!silent) {
          alert(`操作失败: ${err.message || err.toString()}`);
        }
        return false;
      }
    },
    [ensureConnected]
  );

  const handleStateChange = useCallback(
    async (state, { silent = false } = {}) => {
      const ok = await runCommand('set_state', { state }, { silent });
      if (ok) setSelectedState(state);
      return ok;
    },
    [runCommand]
  );

  const handleModeChange = useCallback(
    async (mode, { silent = false } = {}) => {
      const ok = await runCommand('set_mode', { mode }, { silent });
      if (ok) setSelectedMode(mode);
      return ok;
    },
    [runCommand]
  );

  const handleActionChange = useCallback(
    async (action, { silent = false } = {}) => {
      const ok = await runCommand('set_action', { action }, { silent });
      if (ok) setSelectedAction(action);
      return ok;
    },
    [runCommand]
  );

  const handleDanceAction = useCallback(
    async (danceItem, { silent = false } = {}) => {
      if (!ensureConnected()) return false;
      try {
        if (danceItem.mode) {
          await sendControlCommand('set_mode', { mode: danceItem.mode });
          setSelectedMode(danceItem.mode);
        }
        await sendControlCommand('set_action', { action: danceItem.id });
        setSelectedAction(danceItem.id);
        return true;
      } catch (err) {
        console.error('[RobotControl] dance error:', err);
        if (!silent) alert(`操作失败: ${err.message || err.toString()}`);
        return false;
      }
    },
    [ensureConnected]
  );

  const handleVoicePreset = useCallback(
    async (preset, { silent = false } = {}) => {
      if (!ensureConnected()) return false;
      setVoiceSending(preset);
      try {
        await postVoicePreset(preset);
        return true;
      } catch (err) {
        console.error('[RobotControl] Voice TTS error:', err);
        if (!silent) alert(`语音播放失败: ${err.message || err.toString()}`);
        return false;
      } finally {
        setVoiceSending(null);
      }
    },
    [ensureConnected]
  );

  const handleSoftEStop = useCallback(
    async ({ confirm = true, silent = false } = {}) => {
      if (!ensureConnected()) return false;
      if (confirm && !window.confirm('确认软急停？机器人将进入强制阻尼（DAMPING_FORCE）。')) {
        return false;
      }
      if (isWebJoyActive(inputMode) && onSoftEstop) {
        onSoftEstop();
      }
      return handleStateChange(SOFT_ESTOP.id, { silent });
    },
    [ensureConnected, inputMode, onSoftEstop, handleStateChange]
  );

  const handleScriptToggle = useCallback(async () => {
    if (!selectedScript) {
      alert('请先选择一个脚本文件');
      return;
    }
    const nextFlag = scriptRunning ? 0 : 1;
    const ok = await runCommand('script_action', {
      action_name: selectedScript,
      flag: nextFlag,
    });
    if (ok) setScriptRunning(!scriptRunning);
  }, [selectedScript, scriptRunning, runCommand]);

  const executeHotkeyCommand = useCallback(
    async (command) => {
      switch (command.type) {
        case 'soft_estop':
          return handleSoftEStop({ confirm: false, silent: true });
        case 'state':
          return handleStateChange(command.state, { silent: true });
        case 'action':
          return handleActionChange(command.action, { silent: true });
        case 'voice':
          return handleVoicePreset(command.preset, { silent: true });
        default:
          return false;
      }
    },
    [handleSoftEStop, handleStateChange, handleActionChange, handleVoicePreset]
  );

  // 切换成功后写回 App 共享 state，顶栏即时更新（不依赖 WS broadcast）
  const handleInputModeChange = useCallback(
    async (nextMode, { stopJoysticks }) => {
      if (!inputModeReady || nextMode === inputMode) return false;
      if (isWebJoyActive(inputMode) && stopJoysticks) {
        stopJoysticks(true);
      }

      if (!robotStatus?.connected) {
        setInputMode(nextMode);
        return true;
      }

      const ok = await postInputMode(nextMode);
      if (!ok) {
        console.warn('[RobotControl] 切换输入模式失败，请检查后端连接');
        return false;
      }
      setInputMode(nextMode);
      return true;
    },
    [inputMode, inputModeReady, robotStatus?.connected, setInputMode]
  );

  // 仅控制页挂载时订阅：承接偶发 input_mode（如话题切回遥控器）
  useEffect(() => {
    if (!robotStatus?.connected || !sendMessage) return undefined;
    sendMessage({ type: 'subscribe', data: { page: 'control' } });
    return () => {
      sendMessage({ type: 'unsubscribe', data: { page: 'control' } });
    };
  }, [robotStatus?.connected, sendMessage]);

  useEffect(() => {
    if (!addMessageHandler) return undefined;
    const handleMessage = (data) => {
      if (data.type !== 'input_mode' || !data.data) return;
      setInputMode(
        initialModeFromConfig({
          iot_joy_switch: Boolean(data.data.iot_joy_switch),
          web_joy_switch: Boolean(data.data.web_joy_switch),
        })
      );
    };
    return addMessageHandler(handleMessage);
  }, [addMessageHandler, setInputMode]);

  useEffect(() => {
    (async () => {
      const names = await fetchScriptList();
      setScriptList(names);
      if (names.length > 0) {
        setSelectedScript((prev) => prev || names[0]);
      }
    })();
  }, []);

  return {
    selectedState,
    selectedMode,
    selectedAction,
    scriptList,
    selectedScript,
    setSelectedScript,
    scriptRunning,
    voiceSending,
    inputMode,
    inputModeReady,
    handleStateChange,
    handleModeChange,
    handleActionChange,
    handleDanceAction,
    handleVoicePreset,
    handleSoftEStop,
    handleScriptToggle,
    handleInputModeChange,
    executeHotkeyCommand,
  };
}
