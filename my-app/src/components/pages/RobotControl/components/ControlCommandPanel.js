import React from 'react';
import SectionTitle from './SectionTitle';
import {
  SECTION_HOTKEY_HINTS,
  SOFT_ESTOP,
  ROBOT_STATES,
  ROBOT_MODES,
  ROBOT_ACTIONS,
  DANCE_ACTIONS,
  VOICE_PRESETS,
} from '../controlCatalog';

const ControlCommandPanel = ({
  compact = false,
  selectedState,
  selectedMode,
  selectedAction,
  scriptList,
  selectedScript,
  setSelectedScript,
  scriptRunning,
  voiceSending,
  onStateChange,
  onModeChange,
  onActionChange,
  onDanceAction,
  onVoicePreset,
  onSoftEStop,
  onScriptToggle,
}) => {
  const hasStateSection = ROBOT_STATES.length > 0;
  const hasModeSection = ROBOT_MODES.length > 0;
  const hasActionSection = ROBOT_ACTIONS.length > 0;
  const hasVoiceSection = VOICE_PRESETS.length > 0;
  const hasDanceSection = DANCE_ACTIONS.length > 0;
  // 脚本卡暂不做产品差异化，保留在“更多控制”里
  const hasExtraControlSections = true;

  const extraControlSections = (
    <>
      {hasVoiceSection ? (
        <div className="control-section">
          <SectionTitle title="语音控制" hotkeyHint={SECTION_HOTKEY_HINTS.voice} />
          <div className="control-buttons">
            {VOICE_PRESETS.map((item) => (
              <button
                key={item.id}
                type="button"
                className="control-btn primary"
                disabled={voiceSending === item.preset}
                onClick={() => onVoicePreset(item.preset)}
                title={item.hotkeyHint}
              >
                {voiceSending === item.preset ? '发送中…' : item.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {hasDanceSection ? (
        <div className="control-section">
          <SectionTitle title="舞蹈控制" hotkeyHint={SECTION_HOTKEY_HINTS.dance} />
          <div className="control-buttons">
            {DANCE_ACTIONS.map((dance) => (
              <button
                key={dance.id}
                type="button"
                className={`control-btn ${selectedAction === dance.id ? 'primary' : ''}`}
                onClick={() => onDanceAction(dance)}
              >
                {dance.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="control-section">
        <SectionTitle title="脚本控制" hotkeyHint={SECTION_HOTKEY_HINTS.script} />
        <div className="script-control-row">
          <select
            className="script-control-select"
            value={selectedScript}
            onChange={(e) => setSelectedScript(e.target.value)}
            disabled={scriptRunning}
          >
            {scriptList.length === 0 && <option value="">无可用脚本</option>}
            {scriptList.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`control-btn ${scriptRunning ? 'danger' : 'primary'}`}
            onClick={onScriptToggle}
          >
            {scriptRunning ? '停止执行' : '开始执行'}
          </button>
        </div>
        <p className="input-mode-hint script-control-note">
          脚本文件来自
          <code>/app/etc/motor_state_publisher/config/</code>
        </p>
      </div>
    </>
  );

  return (
  <>
    {hasStateSection ? (
      <div className="control-section">
        <SectionTitle title="状态控制" hotkeyHint={SECTION_HOTKEY_HINTS.state} />
        <div className="control-section-row">
          <div className="control-buttons control-section-row__main">
            {ROBOT_STATES.map((state) => (
              <button
                key={state.id}
                type="button"
                className={`control-btn ${selectedState === state.id ? 'primary' : ''}`}
                onClick={() => onStateChange(state.id)}
              >
                {state.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="control-btn danger control-section-row__aside"
            onClick={() => onSoftEStop({ confirm: true })}
            title={`等同遥控器 LB+RB+B；快捷键 ${SOFT_ESTOP.hotkeyHint}`}
          >
            {SOFT_ESTOP.label}
          </button>
        </div>
      </div>
    ) : null}

    {hasModeSection ? (
      <div className="control-section">
        <SectionTitle title="模式控制" hotkeyHint={SECTION_HOTKEY_HINTS.mode} />
        <div className="control-buttons">
          {ROBOT_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              className={`control-btn ${selectedMode === mode.id ? 'primary' : ''}`}
              onClick={() => onModeChange(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>
    ) : null}

    {hasActionSection ? (
      <div className="control-section">
        <SectionTitle title="动作控制" hotkeyHint={SECTION_HOTKEY_HINTS.action} />
        <div className="control-buttons">
          {ROBOT_ACTIONS.map((action) => (
            <button
              key={action.id}
              type="button"
              className={`control-btn ${selectedAction === action.id ? 'primary' : ''}`}
              onClick={() => onActionChange(action.id)}
              title={action.hotkeyHint}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    ) : null}

    {compact && hasExtraControlSections ? (
      <details className="control-more">
        <summary className="control-more__summary">更多控制 · 可选功能</summary>
        <div className="control-more__body">{extraControlSections}</div>
      </details>
    ) : null}
    {!compact ? (
      extraControlSections
    ) : null}
  </>
  );
};

export default ControlCommandPanel;
