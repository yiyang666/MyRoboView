import { apiFetch } from '../../../utils/apiClient';
import { joySwitchesForMode } from './inputModes';

export async function postInputMode(mode) {
  const payload = joySwitchesForMode(mode);
  try {
    const response = await apiFetch('/api/v1/control/input_mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return response.ok;
  } catch (err) {
    console.warn('[RobotControl] input_mode error:', err);
    return false;
  }
}

export async function fetchInputModeConfig() {
  const resp = await apiFetch('/api/v1/control/input_mode');
  if (!resp.ok) return null;
  return resp.json();
}

export async function postJoystick({ move, turn, sessionId, sequence }, { signal } = {}) {
  try {
    const response = await apiFetch('/api/v1/control/joy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      // 一帧包含所有轴，服务端借 session_id + seq 丢弃乱序的陈旧请求
      body: JSON.stringify({
        move,
        turn,
        session_id: sessionId,
        seq: sequence,
      }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.warn('[RobotControl] joy failed:', errorText);
      return {
        ok: false,
        sessionExpired: errorText.includes('Joystick session expired'),
      };
    }
    return { ok: true, sessionExpired: false };
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.warn('[RobotControl] joy error:', err);
    }
    return { ok: false, sessionExpired: false };
  }
}

export async function sendControlCommand(cmdType, data = {}) {
  let url = '';
  let payload = {};

  switch (cmdType) {
    case 'set_state':
      url = '/api/v1/control/state';
      payload = { state: data.state };
      break;
    case 'set_mode':
      url = '/api/v1/control/mode';
      payload = { mode: data.mode };
      break;
    case 'set_action':
      url = '/api/v1/control/action';
      payload = { action: data.action };
      break;
    case 'script_action':
      url = '/api/v1/control/script_action';
      payload = { action_name: data.action_name, flag: data.flag };
      break;
    default:
      throw new Error(`Unknown command type: ${cmdType}`);
  }

  const response = await apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `Failed to execute ${cmdType}`;
    try {
      const errorData = JSON.parse(errorText);
      errorMessage = errorData.error || errorData.message || errorMessage;
    } catch {
      errorMessage = errorText || errorMessage;
    }
    throw new Error(errorMessage);
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || result.message || `Failed to execute ${cmdType}`);
  }
  return result;
}

export async function postVoicePreset(preset) {
  const response = await apiFetch('/api/v1/control/voice/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preset, interrupt: true }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = '语音播放失败';
    try {
      const errorData = JSON.parse(errorText);
      errorMessage = errorData.error || errorData.message || errorMessage;
    } catch {
      errorMessage = errorText || errorMessage;
    }
    throw new Error(errorMessage);
  }
}

export async function fetchScriptList() {
  const resp = await apiFetch('/api/v1/control/scripts');
  if (!resp.ok) return [];
  const data = await resp.json();
  if (data.success && Array.isArray(data.scripts)) {
    return data.scripts.map((s) => s.name);
  }
  return [];
}
