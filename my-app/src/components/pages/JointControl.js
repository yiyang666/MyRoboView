import React, { useEffect, useState } from 'react';
import './Page.css';
import { URDF_CONFIG } from '../../config/robotUrdfConfig';
import { apiFetch } from '../../utils/apiClient';

// 默认关节范围兜底（弧度），实际以 URDF 的 <limit lower/upper> 为准
const DEFAULT_MIN_RAD = -Math.PI;
const DEFAULT_MAX_RAD = Math.PI;
const SLIDER_STEP_RAD = 0.01;

const roundRad = (value) => Math.round(value * 1000) / 1000;
const formatRad3 = (value) => roundRad(value).toFixed(3);

const { joints, urdfPath } = URDF_CONFIG;

const JointControl = ({
  jointAnglesForView,
  onJointAnglesChange,
  jointAngleMode = 'follow',
  onJointAngleModeChange,
  showMotorCalibrate = false,
}) => {
  const [calibModalOpen, setCalibModalOpen] = useState(false);
  const [calibBusy, setCalibBusy] = useState(false);

  // 从 URDF 读取限位（单位：弧度）
  const [urdfJointLimitsRad, setUrdfJointLimitsRad] = useState({});
  // 右侧弧度输入框：聚焦编辑中的草稿，避免跟随后端刷新打断输入
  const [angleDrafts, setAngleDrafts] = useState({});
  const [editingAngleId, setEditingAngleId] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const parseUrdfLimits = async () => {
      try {
        const resp = await fetch(urdfPath);
        if (!resp.ok) return;
        const xml = await resp.text();

        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        if (!doc) return;

        const urdfNameToId = {};
        (joints || []).forEach((j) => {
          if (j?.urdfName != null) urdfNameToId[j.urdfName] = j.id;
        });

        const limitsMap = {};
        const jointNodes = Array.from(doc.getElementsByTagName('joint'));
        jointNodes.forEach((jointNode) => {
          const urdfName = jointNode.getAttribute('name');
          const id = urdfNameToId[urdfName];
          if (id == null) return;

          const limitNode = jointNode.getElementsByTagName('limit')?.[0];
          if (!limitNode) return;

          const lowerStr = limitNode.getAttribute('lower');
          const upperStr = limitNode.getAttribute('upper');
          const lower = Number.parseFloat(lowerStr);
          const upper = Number.parseFloat(upperStr);
          if (!Number.isFinite(lower) || !Number.isFinite(upper)) return;

          limitsMap[id] = {
            min: roundRad(lower),
            max: roundRad(upper),
          };
        });

        if (!cancelled) setUrdfJointLimitsRad(limitsMap);
      } catch (e) {
        console.warn('[JointControl] parse URDF limits failed:', e);
      }
    };

    parseUrdfLimits();
    return () => {
      cancelled = true;
    };
  }, [urdfPath]);

  const getJointLimit = (id) =>
    urdfJointLimitsRad[id] || { min: DEFAULT_MIN_RAD, max: DEFAULT_MAX_RAD };

  const clampToLimit = (id, angleRad) => {
    const { min, max } = getJointLimit(id);
    return roundRad(Math.max(min, Math.min(max, angleRad)));
  };

  const handleSetAngle = (jointId, angleRad) => {
    if (jointAngleMode !== 'slider') return;
    if (typeof onJointAnglesChange !== 'function') return;
    const clamped = clampToLimit(jointId, angleRad);
    onJointAnglesChange((prev) => ({
      ...prev,
      [jointId]: clamped,
    }));
    return clamped;
  };

  // 右侧输入框提交：解析 → 限位钳制 → 回写（可直接填写修改）
  const commitAngleInput = (jointId, rawText) => {
    const parsed = Number.parseFloat(String(rawText).trim());
    if (!Number.isFinite(parsed)) {
      setEditingAngleId(null);
      setAngleDrafts((prev) => {
        const next = { ...prev };
        delete next[jointId];
        return next;
      });
      return;
    }
    const clamped = handleSetAngle(jointId, parsed);
    setEditingAngleId(null);
    setAngleDrafts((prev) => {
      const next = { ...prev };
      if (clamped == null) {
        delete next[jointId];
      } else {
        next[jointId] = formatRad3(clamped);
      }
      return next;
    });
  };

  const handleRandomAll = () => {
    if (jointAngleMode !== 'slider') return;
    if (typeof onJointAnglesChange !== 'function') return;
    const updates = {};
    joints.forEach((joint) => {
      const { min, max } = getJointLimit(joint.id);
      const randomAngle = Math.random() * (max - min) + min;
      updates[joint.id] = roundRad(randomAngle);
    });
    onJointAnglesChange((prev) => ({ ...prev, ...updates }));
  };

  const handleResetAll = () => {
    if (jointAngleMode !== 'slider') return;
    if (typeof onJointAnglesChange !== 'function') return;
    const zeros = {};
    joints.forEach((joint) => {
      zeros[joint.id] = 0;
    });
    onJointAnglesChange(() => zeros);
  };

  const handleOpenCalibModal = () => {
    setCalibModalOpen(true);
  };

  const handleConfirmCalibrate = async () => {
    // 标定应基于真实关节反馈，因此仅允许在 follow 模式下执行
    if (jointAngleMode !== 'follow') {
      alert('请先切换到“跟随电机”模式，再进行标定。');
      return;
    }
    setCalibBusy(true);
    try {
      const resp = await apiFetch('/api/v1/motor/calibrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `HTTP ${resp.status}`);
      }

      setCalibModalOpen(false);
    } catch (e) {
      console.error('[JointControl] calibrate failed:', e);
      alert(`标定失败：${e?.message || e}`);
    } finally {
      setCalibBusy(false);
    }
  };

  return (
    <div className="page-container">
      <h2 className="page-title" style={{ marginTop: '20px' }}>
        关节控制
      </h2>
      <p style={{ fontSize: '12px', color: '#aaa', marginBottom: '12px' }}>
        默认情况下 3D 模型会跟随真实电机反馈（后端 joint_state）。仅在本页面可切换为 slider 自由控制模式。
      </p>

      <div style={{ marginBottom: '16px', display: 'flex', gap: '12px', alignItems: 'center' }}>
        <span style={{ fontSize: '12px', color: '#aaa' }}>关节角来源：</span>
        <button
          className={jointAngleMode === 'follow' ? 'primary-button' : 'secondary-button'}
          onClick={() => typeof onJointAngleModeChange === 'function' && onJointAngleModeChange('follow')}
          title="跟随后端实时电机反馈"
        >
          跟随电机
        </button>
        <button
          className={jointAngleMode === 'slider' ? 'primary-button' : 'secondary-button'}
          onClick={() => typeof onJointAngleModeChange === 'function' && onJointAngleModeChange('slider')}
          title="仅本地 slider 控制 3D 模型"
        >
          自由控制（Slider）
        </button>
        <span style={{ fontSize: '12px', color: jointAngleMode === 'follow' ? '#10b981' : '#f59e0b' }}>
          {jointAngleMode === 'follow' ? '当前：跟随电机（只读）' : '当前：自由控制（可编辑）'}
        </span>

        <div style={{ flex: 1 }} />

        {showMotorCalibrate ? (
        <button
          className="secondary-button"
          onClick={handleOpenCalibModal}
          disabled={calibBusy || jointAngleMode !== 'follow'}
          title={jointAngleMode !== 'follow' ? '请先切换到“跟随电机”模式' : '对当前真实关节位置进行标定'}
        >
          {calibBusy ? '标定中...' : '关节标定'}
        </button>
        ) : null}
      </div>

      <div style={{ marginBottom: '16px', display: 'flex', gap: '12px' }}>
        <button className="primary-button" onClick={handleRandomAll}>
          随机关节角度
        </button>
        <button className="secondary-button" onClick={handleResetAll}>
          关节回正
        </button>
        <span style={{ fontSize: '12px', color: '#aaa' }}>
          （各关节范围已按实际限位约束）
        </span>
        {jointAngleMode === 'follow' && (
          <span style={{ fontSize: '12px', color: '#aaa' }}>
            （提示：切到“自由控制”后 slider 才会生效）
          </span>
        )}
      </div>

      <div
        className="info-grid"
        style={{ gridTemplateColumns: '1fr 1fr', maxHeight: '100%', overflow: 'auto' }}
      >
        {joints.map((joint) => {
          const { min, max } = getJointLimit(joint.id);
          const currentAngle =
            jointAnglesForView[joint.id] != null ? jointAnglesForView[joint.id] : 0;
          const urdfName = joint?.urdfName;

          return (
            <div
              className="info-card"
              key={joint.id}
              style={{ flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                <h3>
                  #{joint.id} {joint.name}
                </h3>
                {urdfName && (
                  <span style={{ fontSize: '15px', color: '#aaa' }}>
                    URDF: {urdfName}
                  </span>
                )}
              </div>
              <div className="joint-angle-row">
                {/* 限位仅显示数值，去掉 rad，避免与右侧单位重复挤占 */}
                <span className="joint-angle-limit">{formatRad3(min)}</span>
                <input
                  className="joint-angle-slider"
                  type="range"
                  min={min}
                  max={max}
                  step={SLIDER_STEP_RAD}
                  value={currentAngle}
                  disabled={jointAngleMode !== 'slider'}
                  onChange={(e) => handleSetAngle(joint.id, parseFloat(e.target.value))}
                />
                <span className="joint-angle-limit is-max">{formatRad3(max)}</span>
                <div className="joint-angle-input-wrap">
                  <input
                    className="joint-angle-input"
                    type="number"
                    step={SLIDER_STEP_RAD}
                    min={min}
                    max={max}
                    disabled={jointAngleMode !== 'slider'}
                    value={
                      editingAngleId === joint.id
                        ? (angleDrafts[joint.id] ?? formatRad3(currentAngle))
                        : formatRad3(currentAngle)
                    }
                    onFocus={() => {
                      setEditingAngleId(joint.id);
                      setAngleDrafts((prev) => ({
                        ...prev,
                        [joint.id]: formatRad3(currentAngle),
                      }));
                    }}
                    onChange={(e) => {
                      const text = e.target.value;
                      setAngleDrafts((prev) => ({ ...prev, [joint.id]: text }));
                      // 合法数字时即时驱动滑条与 3D，便于边填边看
                      const parsed = Number.parseFloat(text);
                      if (Number.isFinite(parsed)) {
                        handleSetAngle(joint.id, parsed);
                      }
                    }}
                    onBlur={(e) => commitAngleInput(joint.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur();
                      } else if (e.key === 'Escape') {
                        setEditingAngleId(null);
                        setAngleDrafts((prev) => {
                          const next = { ...prev };
                          delete next[joint.id];
                          return next;
                        });
                        e.currentTarget.blur();
                      }
                    }}
                    title="当前关节角（弧度），可直接填写"
                    aria-label={`${joint.name} 关节角（弧度）`}
                  />
                  <span className="joint-angle-unit">rad</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {calibModalOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div
            style={{
              width: '520px',
              maxWidth: '90vw',
              background: '#151826',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '14px',
              padding: '18px 18px 14px',
              boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#fff', marginBottom: '10px' }}>
              二次确认
            </div>
            <div style={{ fontSize: '14px', color: '#ddd', lineHeight: 1.6 }}>
              注意：标定前请务必确保关节锁死，是否就机器当前真实关节位置进行标定？
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
              <button
                className="secondary-button"
                onClick={() => setCalibModalOpen(false)}
                disabled={calibBusy}
              >
                取消
              </button>
              <button
                className="primary-button"
                onClick={handleConfirmCalibrate}
                disabled={calibBusy}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default JointControl;
