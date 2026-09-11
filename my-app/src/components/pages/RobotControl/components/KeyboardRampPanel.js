import React, { useState } from 'react';
import { INPUT_MODES } from '../inputModes';
import { RAMP_AXIS_META, RELEASE_MODES } from '../keyboardRampConfig';

const AxisRampControls = ({ axisId, meta, config, onChange }) => (
  <div className="ramp-axis-block">
    <div className="ramp-axis-block__header">
      <label className="ramp-axis-block__title">
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => onChange(axisId, { enabled: e.target.checked })}
        />
        {meta.label}
      </label>
    </div>
    <div className={`ramp-axis-block__body ${config.enabled ? '' : 'ramp-axis-block__body--disabled'}`}>
      <label className="ramp-field">
        <span>加速速率 rampUp</span>
        <input
          type="range"
          min="0.5"
          max="20"
          step="0.5"
          value={config.rampUpRate}
          disabled={!config.enabled}
          onChange={(e) => onChange(axisId, { rampUpRate: Number(e.target.value) })}
        />
        <span className="ramp-field__value">{config.rampUpRate.toFixed(1)}</span>
      </label>
      <label className="ramp-field">
        <span>释放模式</span>
        <select
          className="ramp-release-select"
          value={config.releaseMode}
          disabled={!config.enabled}
          onChange={(e) => onChange(axisId, { releaseMode: e.target.value })}
        >
          <option value={RELEASE_MODES.INSTANT}>瞬时归零（摇杆模式）</option>
          <option value={RELEASE_MODES.RAMP}>平滑减速</option>
        </select>
      </label>
      {config.releaseMode === RELEASE_MODES.RAMP && (
        <label className="ramp-field">
          <span>减速速率 rampDown</span>
          <input
            type="range"
            min="0.5"
            max="20"
            step="0.5"
            value={config.rampDownRate}
            disabled={!config.enabled}
            onChange={(e) => onChange(axisId, { rampDownRate: Number(e.target.value) })}
          />
          <span className="ramp-field__value">{config.rampDownRate.toFixed(1)}</span>
        </label>
      )}
    </div>
  </div>
);

/** 网页控制模式下常驻入口，内容默认折叠 */
const KeyboardRampPanel = ({
  inputMode,
  rampConfig,
  onAxisChange,
  onReset,
}) => {
  const [expanded, setExpanded] = useState(false);

  if (inputMode !== INPUT_MODES.WEB) return null;

  return (
    <div className="control-section keyboard-ramp-panel">
      <button
        type="button"
        className="keyboard-ramp-panel__toggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <h3 className="keyboard-ramp-panel__title">键盘平滑调试</h3>
        <span className="keyboard-ramp-panel__chevron">{expanded ? '▾' : '▸'}</span>
      </button>
      <p className="input-mode-hint">
        仅影响键盘 WASD / ←→；拖动摇杆不受此参数影响。配置保存在浏览器本地。
      </p>
      {expanded && (
        <div className="keyboard-ramp-panel__body">
          {Object.entries(RAMP_AXIS_META).map(([axisId, meta]) => (
            <AxisRampControls
              key={axisId}
              axisId={axisId}
              meta={meta}
              config={rampConfig[axisId]}
              onChange={onAxisChange}
            />
          ))}
          <button type="button" className="control-btn ramp-reset-btn" onClick={onReset}>
            恢复默认
          </button>
        </div>
      )}
    </div>
  );
};

export default KeyboardRampPanel;
