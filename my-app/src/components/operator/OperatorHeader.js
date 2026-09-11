import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { INPUT_MODES } from '../pages/RobotControl/inputModes';
import { inputModeLabel } from '../../hooks/useInputMode';

function connectionClass(connectionState) {
  if (connectionState === 'connected') return 'operator-app__chip--ok';
  if (connectionState === 'timeout') return 'operator-app__chip--warn';
  return 'operator-app__chip--bad';
}

function connectionLabel(connectionState) {
  if (connectionState === 'connected') return '已连接';
  if (connectionState === 'timeout') return '超时';
  return '未连接';
}

function motorLabel(motorHealth) {
  if (motorHealth === 'OK') return { text: '正常', className: 'operator-app__chip--ok' };
  if (motorHealth === 'ERROR') return { text: '异常', className: 'operator-app__chip--bad' };
  return { text: motorHealth || 'Unknown', className: '' };
}

/**
 * 现场壳共用顶栏：连接摘要 + 返回中台 / 退出登录
 */
export default function OperatorHeader({
  robotStatus,
  inputMode = INPUT_MODES.IOT,
  title = '',
  showBack = false,
  backTo = '/operator',
}) {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const motor = motorLabel(robotStatus?.motor_health);
  // 网页遥控时高亮，避免误以为遥控器坏了
  const remoteClass =
    inputMode === INPUT_MODES.WEB ? 'operator-app__chip--warn' : 'operator-app__chip--ok';

  return (
    <header className="operator-app__header">
      <div className="operator-app__header-start">
        {showBack ? (
          <button
            type="button"
            className="operator-app__back"
            onClick={() => navigate(backTo)}
            aria-label="返回中台"
          >
            ←
          </button>
        ) : null}
        {title ? <span className="operator-app__title">{title}</span> : null}
        <div className="operator-app__meta">
          <span
            className={`operator-app__chip ${connectionClass(robotStatus?.connectionState)}`}
          >
            <span className="operator-app__chip-label">连接</span>
            {connectionLabel(robotStatus?.connectionState)}
          </span>
          <span className="operator-app__chip">
            <span className="operator-app__chip-label">状态</span>
            {robotStatus?.status || 'Unknown'}
          </span>
          <span className="operator-app__chip">
            <span className="operator-app__chip-label">模式</span>
            {robotStatus?.mode || 'Unknown'}
          </span>
          <span className="operator-app__chip">
            <span className="operator-app__chip-label">动作</span>
            {robotStatus?.action || 'Unknown'}
          </span>
          <span className={`operator-app__chip ${motor.className}`}>
            <span className="operator-app__chip-label">电机</span>
            {motor.text}
          </span>
          <span className={`operator-app__chip ${remoteClass}`}>
            <span className="operator-app__chip-label">遥控</span>
            {inputModeLabel(inputMode)}
          </span>
          <span className="operator-app__chip">
            <span className="operator-app__chip-label">电量</span>
            {robotStatus?.remaining_power || 0}%
          </span>
        </div>
      </div>
      <button type="button" className="operator-app__logout" onClick={logout}>
        退出
      </button>
    </header>
  );
}
