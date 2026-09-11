/*
 * @Author: ethan.young Ethan.Yang2@lingyiitech.com
 * @Date: 2026-01-28 13:44:23
 * @LastEditors: ethan.young Ethan.Yang2@lingyiitech.com
 * @LastEditTime: 2026-03-12 15:32:38
 * @FilePath: /roboview/my-app/src/components/StatusBar.js
 * @Description: 
 */
import React from 'react';
import './StatusBar.css';
import { INPUT_MODES } from './pages/RobotControl/inputModes';
import { inputModeLabel } from '../hooks/useInputMode';

const StatusBar = ({ robotStatus, connected, inputMode = INPUT_MODES.IOT }) => {
  const getStatusColor = (status) => {
    switch (status) {
      case 'RUNNING': return '#10b981';
      case 'READY': return '#3b82f6';
      case 'DAMPING': return '#f59e0b';
      case 'DISABLED': return '#ffffff';
      case 'TRANSITIONING': return '#8b5cf6';
      case 'Unknown': return '#9ca3af';  // 未连接状态使用浅灰色
      case 'Null': return '#ef4444';      // 收到但为空使用红色，表明传输可能出错
      default: return '#ffffff'; // 默认为白色
    }
  };

  const getMotorHealthDisplay = (motorHealth) => {
    if (motorHealth === 'OK') {
      return { text: '正常', color: '#10b981' };
    }
    if (motorHealth === 'ERROR') {
      return { text: '异常', color: '#ef4444' };
    }
    return { text: 'Unknown', color: '#9ca3af' };
  };

  // 网页遥控用醒目色，提醒测试/现场「不是遥控器坏了」
  const getInputModeColor = (mode) => {
    if (mode === INPUT_MODES.WEB) return '#f59e0b';
    if (mode === INPUT_MODES.IOT) return '#10b981';
    return '#9ca3af';
  };

  const getBatteryColor = (battery) => {
    if (battery > 50) return '#10b981'; // 绿色
    if (battery > 20) return '#f59e0b'; // 黄色
    if (battery >= 0 && battery <= 20) return '#ef4444'; // 红色
    return '#ef4444';
  };

  return (
    <div className="status-bar">
      <div className="status-left">
        <div className="status-item">
          <span className="status-label">连接状态:</span>
          <span className={`status-value ${
            robotStatus.connectionState === 'connected' ? 'connected' : 
            robotStatus.connectionState === 'timeout' ? 'timeout' : 
            'disconnected'
          }`}>
            {robotStatus.connectionState === 'connected' ? '● 已连接' : 
             robotStatus.connectionState === 'timeout' ? '⚠ 超时' : 
             '○ 未连接'}
          </span>
        </div>
        <div className="status-item">
          <span className="status-label">当前状态:</span>
          <span 
            className="status-value" 
            style={{ color: getStatusColor(robotStatus.status) }}
          >
            {robotStatus.status || 'Unknown'}
          </span>
        </div>
        <div className="status-item">
          <span className="status-label">当前模式:</span>
          <span 
            className="status-value"
            style={{ color: getStatusColor(robotStatus.mode) }}
          >
            {robotStatus.mode || 'Unknown'}
          </span>
        </div>
        <div className="status-item">
          <span className="status-label">当前动作:</span>
          <span 
            className="status-value"
            style={{ color: getStatusColor(robotStatus.action) }}
          >
            {robotStatus.action || 'Unknown'}
          </span>
        </div>
        <div className="status-item">
          <span className="status-label">电机状态:</span>
          {(() => {
            const m = getMotorHealthDisplay(robotStatus.motor_health);
            return (
              <span 
                className="status-value"
                style={{ color: m.color }}
              >
                {m.text}
              </span>
            );
          })()}
        </div>
        <div className="status-item">
          <span className="status-label">遥控模式:</span>
          <span
            className="status-value"
            style={{ color: getInputModeColor(inputMode) }}
            title="网页控制时物理遥控器无效，请切回遥控器模式"
          >
            {inputModeLabel(inputMode)}
          </span>
        </div>
      </div>
      <div className="status-right">
        <div 
          className="status-item"
          style={{ position: 'relative', cursor: 'pointer' }}
          onMouseEnter={(e) => { 
            const tooltip = e.currentTarget.querySelector('.battery-tooltip');
            if (tooltip) {
              tooltip.style.visibility = 'visible'; 
              tooltip.style.opacity = '1'; 
            }
          }}
          onMouseLeave={(e) => { 
            const tooltip = e.currentTarget.querySelector('.battery-tooltip');
            if (tooltip) {
              tooltip.style.visibility = 'hidden'; 
              tooltip.style.opacity = '0'; 
            }
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div className="status-item" style={{ marginRight: 0 }}>
              <span className="status-label">电量:</span>
              <div className="battery-container">
                <div 
                  className="battery-level" 
                  style={{ 
                    width: `${robotStatus.remaining_power || 0}%`,
                    backgroundColor: getBatteryColor(robotStatus.remaining_power || 0)  // 随电量变化
                  }}
                />
                <span className="battery-text">
                  {robotStatus.remaining_power || 0}%
                </span>
              </div>
            </div>
            <div className="status-item" style={{ marginRight: 0 }}>
              <span className="status-label">电压:</span>
              <span className="status-value">{robotStatus.battery_voltage || 0.0}V</span>
            </div>
            <div className="status-item" style={{ marginRight: 0 }}>
              <span className="status-label">温度:</span>
              <span className="status-value">
                {(robotStatus.current_temp ?? 0)}°C
              </span>
            </div>
          </div>

          {/* 电池详细信息弹窗 */}
          <div
            className="battery-tooltip"
            style={{
              visibility: 'hidden',
              opacity: 0,
              transition: 'opacity 0.2s',
              position: 'absolute',
              bottom: '100%',
              right: 0,
              backgroundColor: 'rgba(30, 30, 30, 0.95)',
              color: '#fff',
              padding: '10px 14px',
              borderRadius: '8px',
              whiteSpace: 'nowrap',
              zIndex: 20,
              fontSize: '13px',
              marginBottom: '8px',
              boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
              border: '1px solid rgba(255,255,255,0.1)',
              lineHeight: 1.6,
              minWidth: '220px'
            }}
          >
            <div>
              <span style={{ color: '#9ca3af' }}>电池电流：</span>
              {robotStatus.battery_current ?? 0}A
            </div>
            <div>
              <span style={{ color: '#9ca3af' }}>充放电时长：</span>
              {robotStatus.startup_cnt ?? 0}
            </div>
            <div>
              <span style={{ color: '#9ca3af' }}>电池状态：</span>
              {robotStatus.battery_state ?? 0}
            </div>
            <div>
              <span style={{ color: '#9ca3af' }}>错误码：</span>
              {robotStatus.battery_errcode ?? 0}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StatusBar;
