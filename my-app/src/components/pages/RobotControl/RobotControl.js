import React, { useState, useRef, useEffect, useCallback } from 'react';
import '../Page.css';
import { JOY_ZERO } from './constants';
import { INPUT_MODES } from './inputModes';
import { useControlCommands } from './hooks/useControlCommands';
import { useJoystickControl } from './hooks/useJoystickControl';
import { useControlHotkeys } from './hooks/useControlHotkeys';
import ControlCommandPanel from './components/ControlCommandPanel';
import InputModePanel from './components/InputModePanel';
import { useKeyboardRampConfig } from './hooks/useKeyboardRampConfig';
import KeyboardRampPanel from './components/KeyboardRampPanel';
import JoystickPanel from './components/JoystickPanel';

const RobotControl = ({
  robotStatus,
  sendMessage,
  addMessageHandler,
  variant = 'console',
  inputMode: sharedInputMode,
  setInputMode: setSharedInputMode,
  inputModeReady: sharedInputModeReady,
}) => {
  const isOperator = variant === 'operator';
  const [moveValue, setMoveValue] = useState(JOY_ZERO);
  const [turnValue, setTurnValue] = useState(JOY_ZERO);
  const [pressedMoveKeys, setPressedMoveKeys] = useState([]);
  const [pressedTurnKeys, setPressedTurnKeys] = useState([]);
  const [isDraggingMove, setIsDraggingMove] = useState(false);
  const [isDraggingTurn, setIsDraggingTurn] = useState(false);
  const [isJoystickFullscreen, setIsJoystickFullscreen] = useState(false);

  const commitMoveRef = useRef(null);
  const commitTurnRef = useRef(null);
  const stopJoysticksRef = useRef(null);
  // 拖动圆环时屏蔽键盘 RAF，避免互相覆盖
  const pointerDraggingRef = useRef(false);
  const isDraggingMoveRef = useRef(false);
  const isDraggingTurnRef = useRef(false);
  // 分别记录两个摇杆占用的指针，允许两根手指同时控制
  const movePointerIdRef = useRef(null);
  const turnPointerIdRef = useRef(null);

  const syncPointerDragging = useCallback(() => {
    pointerDraggingRef.current = isDraggingMoveRef.current || isDraggingTurnRef.current;
  }, []);

  const { rampConfig, rampConfigRef, updateAxis, resetRampConfig } = useKeyboardRampConfig();

  const commands = useControlCommands(robotStatus, {
    onSoftEstop: () => stopJoysticksRef.current?.(true),
    sendMessage,
    addMessageHandler,
    inputMode: sharedInputMode,
    setInputMode: setSharedInputMode,
    inputModeReady: sharedInputModeReady,
  });

  const { inputMode } = commands;

  const syncPressedKeyDisplay = useCallback((moveKeys, turnKeys) => {
    setPressedMoveKeys([...(moveKeys || [])]);
    setPressedTurnKeys([...(turnKeys || [])]);
  }, []);

  const joystick = useJoystickControl({
    robotStatus,
    inputMode,
    commitMoveRef,
    commitTurnRef,
    rampConfigRef,
    pointerDraggingRef,
    onKeysChange: syncPressedKeyDisplay,
  });

  const commitMove = useCallback(
    (joy, opts) => {
      setMoveValue(joy);
      return joystick.commitMove(joy, opts);
    },
    [joystick]
  );

  const commitTurn = useCallback(
    (joy, opts) => {
      setTurnValue(joy);
      return joystick.commitTurn(joy, opts);
    },
    [joystick]
  );

  commitMoveRef.current = commitMove;
  commitTurnRef.current = commitTurn;

  const stopJoysticks = useCallback(
    (postStop) => {
      const result = joystick.stopJoysticks(postStop);
      setIsDraggingMove(false);
      setIsDraggingTurn(false);
      isDraggingMoveRef.current = false;
      isDraggingTurnRef.current = false;
      movePointerIdRef.current = null;
      turnPointerIdRef.current = null;
      pointerDraggingRef.current = false;
      setMoveValue(result.move);
      setTurnValue(result.turn);
    },
    [joystick]
  );

  stopJoysticksRef.current = stopJoysticks;

  useControlHotkeys({
    inputMode,
    onCommand: commands.executeHotkeyCommand,
  });

  const handleInputModeChange = useCallback(
    async (nextMode) => {
      const changed = await commands.handleInputModeChange(nextMode, { stopJoysticks });
      if (!changed) return;
      if (nextMode !== INPUT_MODES.WEB) {
        setIsJoystickFullscreen(false);
        return;
      }
      // 遥控壳切到网页控制后直接进已有全屏摇杆，避免在小屏里找按钮
      if (isOperator) {
        setIsJoystickFullscreen(true);
      }
    },
    [commands, stopJoysticks, isOperator]
  );

  const enterJoystickFullscreen = useCallback(() => {
    if (inputMode !== INPUT_MODES.WEB) return;
    setIsJoystickFullscreen(true);
  }, [inputMode]);

  const exitJoystickFullscreen = useCallback(() => {
    // 布局切换会改变摇杆尺寸，先回零避免沿用切换前的指针坐标
    stopJoysticksRef.current?.(true);
    setIsJoystickFullscreen(false);
  }, []);

  useEffect(() => {
    if (!isJoystickFullscreen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // 用页面级状态同步隐藏固定侧栏，避免全屏操作时误触页面导航
    document.body.classList.add('joystick-fullscreen-active');
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') exitJoystickFullscreen();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.classList.remove('joystick-fullscreen-active');
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isJoystickFullscreen, exitJoystickFullscreen]);

  useEffect(() => {
    // 页面失焦、切到后台或离开时主动回零，避免移动端手势被系统中断后继续输出
    const stopForPageLeave = () => stopJoysticksRef.current?.(true);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') stopForPageLeave();
    };

    window.addEventListener('blur', stopForPageLeave);
    window.addEventListener('pagehide', stopForPageLeave);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('blur', stopForPageLeave);
      window.removeEventListener('pagehide', stopForPageLeave);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const updateMoveValue = useCallback(
    (e) => {
      const joy = joystick.pointerToJoystick(e, joystick.moveCircleRef);
      if (!joy) return;
      commitMove(joy);
    },
    [commitMove, joystick]
  );

  const updateTurnValue = useCallback(
    (e) => {
      const joy = joystick.pointerToJoystick(e, joystick.turnCircleRef);
      if (!joy) return;
      commitTurn({ x: 0, y: joy.y });
    },
    [commitTurn, joystick]
  );

  const handleMoveCirclePointerDown = useCallback(
    (e) => {
      if (inputMode !== INPUT_MODES.WEB) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (movePointerIdRef.current !== null) return;
      e.preventDefault();
      movePointerIdRef.current = e.pointerId;
      // 捕获指针后，手指即使移出圆环也能继续收到移动和松开事件
      e.currentTarget.setPointerCapture?.(e.pointerId);
      isDraggingMoveRef.current = true;
      syncPointerDragging();
      setIsDraggingMove(true);
      updateMoveValue(e);
    },
    [inputMode, updateMoveValue, syncPointerDragging]
  );

  const handleMoveCirclePointerMove = useCallback(
    (e) => {
      if (
        inputMode !== INPUT_MODES.WEB ||
        movePointerIdRef.current !== e.pointerId
      ) {
        return;
      }
      e.preventDefault();
      updateMoveValue(e);
    },
    [inputMode, updateMoveValue]
  );

  const handleMoveCirclePointerEnd = useCallback((e) => {
    if (movePointerIdRef.current !== e.pointerId) return;
    movePointerIdRef.current = null;
    isDraggingMoveRef.current = false;
    syncPointerDragging();
    setIsDraggingMove(false);
    commitMove(JOY_ZERO);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, [commitMove, syncPointerDragging]);

  const handleTurnCirclePointerDown = useCallback(
    (e) => {
      if (inputMode !== INPUT_MODES.WEB) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (turnPointerIdRef.current !== null) return;
      e.preventDefault();
      turnPointerIdRef.current = e.pointerId;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      isDraggingTurnRef.current = true;
      syncPointerDragging();
      setIsDraggingTurn(true);
      updateTurnValue(e);
    },
    [inputMode, updateTurnValue, syncPointerDragging]
  );

  const handleTurnCirclePointerMove = useCallback(
    (e) => {
      if (
        inputMode !== INPUT_MODES.WEB ||
        turnPointerIdRef.current !== e.pointerId
      ) {
        return;
      }
      e.preventDefault();
      updateTurnValue(e);
    },
    [inputMode, updateTurnValue]
  );

  const handleTurnCirclePointerEnd = useCallback((e) => {
    if (turnPointerIdRef.current !== e.pointerId) return;
    turnPointerIdRef.current = null;
    isDraggingTurnRef.current = false;
    syncPointerDragging();
    setIsDraggingTurn(false);
    commitTurn(JOY_ZERO);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, [commitTurn, syncPointerDragging]);

  const moveKeyActive = (code) => pressedMoveKeys.includes(code);
  const turnKeyActive = (code) => pressedTurnKeys.includes(code);

  return (
    <div className="page-container">
      <h2 className="page-title">机器人控制</h2>

      <div className="control-layout">
        <div className="control-left">
          <ControlCommandPanel
            compact={isOperator}
            selectedState={commands.selectedState}
            selectedMode={commands.selectedMode}
            selectedAction={commands.selectedAction}
            scriptList={commands.scriptList}
            selectedScript={commands.selectedScript}
            setSelectedScript={commands.setSelectedScript}
            scriptRunning={commands.scriptRunning}
            voiceSending={commands.voiceSending}
            onStateChange={commands.handleStateChange}
            onModeChange={commands.handleModeChange}
            onActionChange={commands.handleActionChange}
            onDanceAction={commands.handleDanceAction}
            onVoicePreset={commands.handleVoicePreset}
            onSoftEStop={commands.handleSoftEStop}
            onScriptToggle={commands.handleScriptToggle}
          />
        </div>

        <div className="control-right">
          <InputModePanel
            compact={isOperator}
            inputMode={inputMode}
            inputModeReady={commands.inputModeReady}
            robotConnected={robotStatus?.connected}
            onInputModeChange={handleInputModeChange}
            moveKeyActive={moveKeyActive}
            turnKeyActive={turnKeyActive}
          />

          {!isOperator && (
            <KeyboardRampPanel
              inputMode={inputMode}
              rampConfig={rampConfig}
              onAxisChange={updateAxis}
              onReset={resetRampConfig}
            />
          )}

          <JoystickPanel
            inputMode={inputMode}
            isFullscreen={isJoystickFullscreen}
            moveValue={moveValue}
            turnValue={turnValue}
            moveCircleRef={joystick.moveCircleRef}
            turnCircleRef={joystick.turnCircleRef}
            isDraggingMove={isDraggingMove}
            isDraggingTurn={isDraggingTurn}
            onMovePointerDown={handleMoveCirclePointerDown}
            onMovePointerMove={handleMoveCirclePointerMove}
            onMovePointerEnd={handleMoveCirclePointerEnd}
            onTurnPointerDown={handleTurnCirclePointerDown}
            onTurnPointerMove={handleTurnCirclePointerMove}
            onTurnPointerEnd={handleTurnCirclePointerEnd}
            onEnterFullscreen={enterJoystickFullscreen}
            onExitFullscreen={exitJoystickFullscreen}
            onSoftEStop={commands.handleSoftEStop}
          />
        </div>
      </div>
    </div>
  );
};

export default RobotControl;
