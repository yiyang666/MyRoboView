import React from 'react';
import { INPUT_MODES } from '../inputModes';
import { WasdKeyPad, ArrowKeyPad } from './KeyPad';

const InputModePanel = ({
  compact = false,
  inputMode,
  inputModeReady,
  robotConnected,
  onInputModeChange,
  moveKeyActive,
  turnKeyActive,
}) => {
  const webActive = inputMode === INPUT_MODES.WEB;

  return (
    <div className="control-section">
      <h3>控制模式切换</h3>
      <div className="input-mode-row">
        <div className="input-mode-col">
          <div className="input-mode-buttons">
            <button
              type="button"
              className={`control-btn input-mode-btn ${webActive ? 'active' : ''}`}
              disabled={!inputModeReady}
              onClick={() => onInputModeChange(INPUT_MODES.WEB)}
            >
              网页控制
            </button>
            <button
              type="button"
              className={`control-btn input-mode-btn ${inputMode === INPUT_MODES.IOT ? 'active' : ''}`}
              disabled={!inputModeReady}
              onClick={() => onInputModeChange(INPUT_MODES.IOT)}
            >
              遥控器控制
            </button>
          </div>
          {webActive && (
            <p className="input-mode-hint">
              {compact
                ? '可拖动圆环；点「全屏控制」进入双摇杆。'
                : '可拖动圆环或使用键盘（WASD / ←→）；快捷键（Alt+1~4、1~8、P）在本模式下生效。'}
            </p>
          )}
          {inputMode === INPUT_MODES.IOT && (
            <p className="input-mode-hint">已切换至物理遥控器；网页摇杆与键盘输入已关闭。</p>
          )}
          {!robotConnected && (
            <p className="input-mode-hint input-mode-hint--warn">
              机器人未连接，摇杆指令不会发送。
            </p>
          )}
        </div>
        {!compact && (
          <div className="input-mode-keypads">
            <WasdKeyPad moveKeyActive={moveKeyActive} keyboardMode={webActive} />
            <ArrowKeyPad turnKeyActive={turnKeyActive} keyboardMode={webActive} />
          </div>
        )}
      </div>
    </div>
  );
};

export default InputModePanel;
