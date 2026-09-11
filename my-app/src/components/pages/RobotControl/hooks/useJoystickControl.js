import { useCallback, useEffect, useRef } from 'react';
import { JOY_ZERO, MOVE_KEYS, TURN_KEYS, ALL_JOY_KEYS } from '../constants';
import { isEditableTarget } from '../hotkeyEngine';
import { INPUT_MODES, isWebJoyActive } from '../inputModes';
import {
  targetMoveX,
  targetMoveY,
  computeTurnJoy,
  rampMoveAxis,
  pointerToJoystick,
} from '../joystickMath';
import { postJoystick } from '../controlApi';

const JOYSTICK_HEARTBEAT_MS = 100;
const JOYSTICK_REQUEST_TIMEOUT_MS = 750;

const shouldBlockJoyKey = (e) => e.altKey || e.metaKey;

const createSessionId = () => {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export function useJoystickControl({
  robotStatus,
  inputMode,
  commitMoveRef,
  commitTurnRef,
  rampConfigRef,
  /** 鼠标拖动摇杆时为 true，避免键盘 RAF 覆盖指针输出 */
  pointerDraggingRef,
  onKeysChange,
}) {
  const moveCircleRef = useRef(null);
  const turnCircleRef = useRef(null);
  const moveKeysRef = useRef(new Set());
  const turnKeysRef = useRef(new Set());
  // 所有输入源只更新本地目标；网络层以固定频率发送完整摇杆状态
  const targetMoveRef = useRef({ ...JOY_ZERO });
  const targetTurnRef = useRef({ ...JOY_ZERO });
  const smoothMoveRef = useRef({ x: 0, y: 0 });
  const smoothTurnRef = useRef(0);
  const keyboardRampTsRef = useRef(0);
  const inputModeRef = useRef(inputMode);
  const connectedRef = useRef(robotStatus?.connected);
  const onKeysChangeRef = useRef(onKeysChange);
  const sessionIdRef = useRef(createSessionId());
  const sequenceRef = useRef(0);
  const requestInFlightRef = useRef(false);
  const requestAbortRef = useRef(null);

  inputModeRef.current = inputMode;
  connectedRef.current = robotStatus?.connected;
  onKeysChangeRef.current = onKeysChange;

  const notifyKeysChange = useCallback(() => {
    onKeysChangeRef.current?.(moveKeysRef.current, turnKeysRef.current);
  }, []);

  const sendLatestJoystick = useCallback(() => {
    if (
      requestInFlightRef.current ||
      !connectedRef.current ||
      !isWebJoyActive(inputModeRef.current)
    ) {
      return;
    }

    requestInFlightRef.current = true;
    const controller = new AbortController();
    requestAbortRef.current = controller;
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      JOYSTICK_REQUEST_TIMEOUT_MS
    );
    const payload = {
      move: { ...targetMoveRef.current },
      turn: { ...targetTurnRef.current },
      sessionId: sessionIdRef.current,
      sequence: ++sequenceRef.current,
    };

    postJoystick(payload, { signal: controller.signal })
      .then((result) => {
        // 服务端看门狗已让旧会话失效时，轮换 session，下一次心跳安全地重新获取租约
        if (result.sessionExpired) {
          sessionIdRef.current = createSessionId();
          sequenceRef.current = 0;
        }
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        if (requestAbortRef.current === controller) {
          requestAbortRef.current = null;
        }
        requestInFlightRef.current = false;
      });
  }, []);

  const commitMove = useCallback((joy) => {
    targetMoveRef.current = { ...joy };
    return joy;
  }, []);

  const commitTurn = useCallback((joy) => {
    targetTurnRef.current = { ...joy };
    return joy;
  }, []);

  const resetKeyboardRamp = useCallback(() => {
    smoothMoveRef.current = { x: 0, y: 0 };
    smoothTurnRef.current = 0;
    keyboardRampTsRef.current = 0;
  }, []);

  const stopJoysticks = useCallback(
    (postStop) => {
      moveKeysRef.current.clear();
      turnKeysRef.current.clear();
      resetKeyboardRamp();
      notifyKeysChange();
      targetMoveRef.current = { ...JOY_ZERO };
      targetTurnRef.current = { ...JOY_ZERO };

      // 立即请求一次零值；固定心跳会继续补发，后端看门狗负责最终兜底
      if (postStop) sendLatestJoystick();
      return { move: JOY_ZERO, turn: JOY_ZERO };
    },
    [notifyKeysChange, resetKeyboardRamp, sendLatestJoystick]
  );

  // 网页控制以 10Hz 发送完整摇杆包：持键/拖动时是心跳，停止时持续补发零值。
  useEffect(() => {
    if (
      inputMode !== INPUT_MODES.WEB ||
      !robotStatus?.connected
    ) {
      return undefined;
    }

    sendLatestJoystick();
    const timerId = window.setInterval(sendLatestJoystick, JOYSTICK_HEARTBEAT_MS);
    return () => window.clearInterval(timerId);
  }, [inputMode, robotStatus?.connected, sendLatestJoystick]);

  // 网页控制：键盘斜坡 + 本地目标更新（拖动圆环时跳过，避免覆盖指针）
  useEffect(() => {
    if (inputMode !== INPUT_MODES.WEB) return undefined;

    resetKeyboardRamp();
    let rafId = 0;

    const tick = (ts) => {
      if (!keyboardRampTsRef.current) keyboardRampTsRef.current = ts;
      const dtSec = Math.min((ts - keyboardRampTsRef.current) / 1000, 0.05);
      keyboardRampTsRef.current = ts;

      const cfg = rampConfigRef?.current;
      const moveKeys = moveKeysRef.current;
      const turnKeys = turnKeysRef.current;
      const smooth = smoothMoveRef.current;

      smooth.x = rampMoveAxis(smooth.x, targetMoveX(moveKeys), dtSec, cfg?.x);
      smooth.y = rampMoveAxis(smooth.y, targetMoveY(moveKeys), dtSec, cfg?.y);
      smoothTurnRef.current = rampMoveAxis(
        smoothTurnRef.current,
        computeTurnJoy(turnKeys).y,
        dtSec,
        cfg?.turn
      );

      if (!pointerDraggingRef?.current) {
        commitMoveRef.current?.({ x: smooth.x, y: smooth.y });
        commitTurnRef.current?.({ x: 0, y: smoothTurnRef.current });
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      resetKeyboardRamp();
    };
  }, [inputMode, resetKeyboardRamp, commitMoveRef, commitTurnRef, rampConfigRef, pointerDraggingRef]);

  const releaseAllJoyKeys = useCallback(() => stopJoysticks(true), [stopJoysticks]);

  useEffect(() => {
    if (inputMode !== INPUT_MODES.WEB) return undefined;

    const onKeyDown = (e) => {
      if (isEditableTarget(e.target)) return;
      if (!ALL_JOY_KEYS.has(e.code) || shouldBlockJoyKey(e)) return;
      e.preventDefault();
      if (e.repeat) return;

      let changed = false;
      if (MOVE_KEYS.has(e.code) && !moveKeysRef.current.has(e.code)) {
        moveKeysRef.current.add(e.code);
        changed = true;
      }
      if (TURN_KEYS.has(e.code) && !turnKeysRef.current.has(e.code)) {
        turnKeysRef.current.add(e.code);
        changed = true;
      }
      if (changed) notifyKeysChange();
    };

    const onKeyUp = (e) => {
      if (!ALL_JOY_KEYS.has(e.code)) return;
      const changed =
        moveKeysRef.current.delete(e.code) || turnKeysRef.current.delete(e.code);
      if (changed) notifyKeysChange();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', releaseAllJoyKeys);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releaseAllJoyKeys);
      releaseAllJoyKeys();
    };
  }, [inputMode, releaseAllJoyKeys, notifyKeysChange]);

  useEffect(() => {
    return () => {
      requestAbortRef.current?.abort();
      // 卸载后后端看门狗会在 300ms 内自动归零，避免依赖不可达的卸载请求
      targetMoveRef.current = { ...JOY_ZERO };
      targetTurnRef.current = { ...JOY_ZERO };
    };
  }, []);

  return {
    moveCircleRef,
    turnCircleRef,
    moveKeysRef,
    turnKeysRef,
    commitMove,
    commitTurn,
    stopJoysticks,
    releaseAllJoyKeys,
    pointerToJoystick,
  };
}
