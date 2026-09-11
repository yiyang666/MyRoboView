import React from 'react';
import { INPUT_MODES } from '../inputModes';
import { joystickToSvg } from '../joystickMath';

const JoystickPanel = ({
  inputMode,
  isFullscreen,
  moveValue,
  turnValue,
  moveCircleRef,
  turnCircleRef,
  isDraggingMove,
  isDraggingTurn,
  onMovePointerDown,
  onMovePointerMove,
  onMovePointerEnd,
  onTurnPointerDown,
  onTurnPointerMove,
  onTurnPointerEnd,
  onEnterFullscreen,
  onExitFullscreen,
  onSoftEStop,
}) => {
  const circleInactive = inputMode !== INPUT_MODES.WEB;
  const circleShielded = inputMode === INPUT_MODES.IOT;

  return (
    <div
      className={`control-section joystick-control-section ${
        isFullscreen ? 'joystick-control-section--fullscreen' : ''
      }`}
    >
      <div className="joystick-control-header">
        <h3>摇杆控制</h3>
        {isFullscreen ? (
          <div className="joystick-control-header__actions">
            <button
              type="button"
              className="joystick-fullscreen-btn joystick-fullscreen-btn--estop"
              onClick={() => onSoftEStop({ confirm: true })}
              aria-label="软急停"
            >
              软急停
            </button>
            <button
              type="button"
              className="joystick-fullscreen-btn joystick-fullscreen-btn--exit"
              onClick={onExitFullscreen}
              aria-label="退出摇杆全屏"
            >
              退出全屏
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="joystick-fullscreen-btn"
            onClick={onEnterFullscreen}
            disabled={circleInactive}
            title={circleInactive ? '请先切换到网页控制模式' : '全屏显示双摇杆'}
          >
            全屏控制
          </button>
        )}
      </div>
      <div className="joystick-dual-row">
        <div className="joystick-panel">
          <h4 className="joystick-panel__title">移动轴 · X 前后 / Y 左右</h4>
          <div className="circle-control-container circle-control-container--compact">
            <div
              ref={moveCircleRef}
              className={`circle-control ${circleInactive ? 'circle-control--inactive' : ''} ${circleShielded ? 'circle-control--shielded' : ''}`}
              onPointerDown={onMovePointerDown}
              onPointerMove={onMovePointerMove}
              onPointerUp={onMovePointerEnd}
              onPointerCancel={onMovePointerEnd}
              onLostPointerCapture={onMovePointerEnd}
              style={{
                cursor:
                  inputMode === INPUT_MODES.WEB
                    ? isDraggingMove
                      ? 'grabbing'
                      : 'grab'
                    : 'not-allowed',
              }}
            >
              <svg width="200" height="200" viewBox="0 0 200 200">
                <circle cx="100" cy="100" r="80" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2" />
                <circle cx="100" cy="100" r="60" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
                <circle cx="100" cy="100" r="40" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
                <line x1="100" y1="20" x2="100" y2="180" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
                <line x1="20" y1="100" x2="180" y2="100" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
                <circle
                  cx={joystickToSvg(moveValue).cx}
                  cy={joystickToSvg(moveValue).cy}
                  r="8"
                  fill="#3b82f6"
                  stroke="#ffffff"
                  strokeWidth="2"
                />
              </svg>
            </div>
            <div className="circle-control-label">
              X: {moveValue.x.toFixed(2)} · Y: {moveValue.y.toFixed(2)}
            </div>
          </div>
        </div>

        <div className="joystick-panel">
          <h4 className="joystick-panel__title">转向轴 · 仅 Y 左右</h4>
          <div className="circle-control-container circle-control-container--compact">
            <div
              ref={turnCircleRef}
              className={`circle-control ${circleInactive ? 'circle-control--inactive' : ''} ${circleShielded ? 'circle-control--shielded' : ''}`}
              onPointerDown={onTurnPointerDown}
              onPointerMove={onTurnPointerMove}
              onPointerUp={onTurnPointerEnd}
              onPointerCancel={onTurnPointerEnd}
              onLostPointerCapture={onTurnPointerEnd}
              style={{
                cursor:
                  inputMode === INPUT_MODES.WEB
                    ? isDraggingTurn
                      ? 'grabbing'
                      : 'grab'
                    : 'not-allowed',
              }}
            >
              <svg width="200" height="200" viewBox="0 0 200 200">
                <circle cx="100" cy="100" r="80" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2" />
                <circle cx="100" cy="100" r="60" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
                <circle cx="100" cy="100" r="40" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
                <line x1="100" y1="20" x2="100" y2="180" stroke="rgba(255,255,255,0.35)" strokeWidth="1" strokeDasharray="4 4" />
                <line x1="20" y1="100" x2="180" y2="100" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
                <circle
                  cx={joystickToSvg(turnValue).cx}
                  cy={100}
                  r="8"
                  fill="#10b981"
                  stroke="#ffffff"
                  strokeWidth="2"
                />
              </svg>
            </div>
            <div className="circle-control-label">
              Y: {turnValue.y.toFixed(2)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default JoystickPanel;
