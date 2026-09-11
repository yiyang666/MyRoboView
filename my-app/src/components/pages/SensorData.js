import React, { useState, useEffect, useRef } from 'react';
import './Page.css';
import { apiFetch } from '../../utils/apiClient';

const SensorData = ({ robotStatus, sendMessage, addMessageHandler, connected }) => {
  const [imuEnabled, setImuEnabled] = useState(false); // 初始状态，等待从传感器状态话题获取
  const [isLoading, setIsLoading] = useState(false);
  const [imuFrequency, setImuFrequency] = useState(null); // IMU 消息频率（Hz），null 表示无数据
  const [cameraEnabled, setCameraEnabled] = useState(false); // 摄像头开关（预留）
  const [lidarEnabled, setLidarEnabled] = useState(false); // 激光雷达开关（预留）
  // 纯前端：默认隐藏详情，点开眼睛后才显示开关与数据（后台仍照常收消息）
  const [showDetail, setShowDetail] = useState({ imu: false, camera: false, lidar: false });
  // 本会话内用户是否手动关闭了 IMU 开关；刷新页面后重置，允许从机器端状态同步
  const userDisabledImuRef = useRef(false);

  // 页面订阅：只在机器连接且页面激活时订阅
  useEffect(() => {
    if (robotStatus?.connected && sendMessage) {
      // 订阅传感器页面
      sendMessage({
        type: 'subscribe',
        data: { page: 'sensor' }
      });
      
      return () => {
        // 取消订阅
        sendMessage({
          type: 'unsubscribe',
          data: { page: 'sensor' }
        });
      };
    }
  }, [robotStatus?.connected, sendMessage]);

  // 接收 WebSocket 消息（处理 IMU 频率数据）
  useEffect(() => {
    if (!addMessageHandler) return;
    const handleMessage = (data) => {
      if (data.type === 'sensor_imu_frequency') {
        // 用户本会话内手动关闭时，忽略机器端数据；刷新后 ref 重置，可自动同步
        if (userDisabledImuRef.current) return;
        setImuEnabled(true);
        if (data.data && typeof data.data.frequency === 'number') {
          setImuFrequency(data.data.frequency);
        }
      }
    };

    const removeHandler = addMessageHandler(handleMessage);
    return removeHandler;
  }, [addMessageHandler]);

  // 当连接断开或机器人未连接时，重置所有数据
  useEffect(() => {
    if (!connected || !robotStatus?.connected) {
      // 重置 IMU 频率
      setImuFrequency(null);
      userDisabledImuRef.current = false;
      // 重置所有传感器开关状态
      setImuEnabled(false);
      setCameraEnabled(false);
      setLidarEnabled(false);
      setShowDetail({ imu: false, camera: false, lidar: false });
    }
  }, [connected, robotStatus?.connected]);

  const eyeBtn = (key) => (
    <button
      type="button"
      className="page-reveal-btn"
      onClick={() => setShowDetail((s) => ({ ...s, [key]: !s[key] }))}
      disabled={!connected || !robotStatus?.connected}
      aria-label={showDetail[key] ? '隐藏' : '显示'}
    >
      {showDetail[key] ? '👁' : '🙈'}
    </button>
  );

  // 摄像头开关处理（预留，暂时不做任何功能）
  const handleCameraToggle = async (enabled) => {
    if (isLoading) return;
    if (!connected || !robotStatus?.connected) {
      alert('无法操作：后端服务未连接或机器人未连接');
      return;
    }
    // TODO: 实现摄像头控制功能
    setCameraEnabled(enabled);
    console.log(`Camera ${enabled ? 'enabled' : 'disabled'} (placeholder)`);
  };

  // 激光雷达开关处理（预留，暂时不做任何功能）
  const handleLidarToggle = async (enabled) => {
    if (isLoading) return;
    if (!connected || !robotStatus?.connected) {
      alert('无法操作：后端服务未连接或机器人未连接');
      return;
    }
    // TODO: 实现激光雷达控制功能
    setLidarEnabled(enabled);
    console.log(`Lidar ${enabled ? 'enabled' : 'disabled'} (placeholder)`);
  };

  const handleImuToggle = async (enabled) => {
    if (isLoading) return;
    
    // 检查连接状态
    if (!connected || !robotStatus?.connected) {
      alert('无法操作：后端服务未连接或机器人未连接');
      return;
    }
    setIsLoading(true); // 设置loading状态，防止重复更新
  
    try {
      const action = enabled ? 'start' : 'stop';
      const url = `/api/v1/sensor/imu/${action}`;
      const response = await apiFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (enabled) {
        userDisabledImuRef.current = false;
        setImuEnabled(true);
        setImuFrequency(null); // 等待后端广播新数据
      } else {
        userDisabledImuRef.current = true;
        setImuEnabled(false);
        setImuFrequency(null); // 关闭后清空频率显示
      }

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `Failed to ${action} IMU`;
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch {
          errorMessage = errorText || errorMessage;
        }
        throw new Error(errorMessage);
      }
      
      const data = await response.json();
      if (data.success) {
        console.log(`IMU ${action} command sent:`, data.message);
        // UI状态已经在上面乐观更新了，这里不需要再更新
      } else {
        throw new Error(data.error || data.message || `Failed to ${action} IMU`);
      }
    } catch (err) {
      console.error(`Error toggling IMU:`, err);
      // 如果命令发送失败，恢复开关状态
      setImuEnabled(!enabled);
      userDisabledImuRef.current = enabled;
      const errorMsg = err.message || '未知错误';
      alert(`操作失败: ${errorMsg}`);
    } finally {
        setTimeout(() => {
          setIsLoading(false);
        }, 1000);
    }
  };

  return (
    <div className="page-container">
      <h2 className="page-title">传感器状态</h2>
      <div className="sensor-grid">
        <div className={`sensor-card ${(!connected || !robotStatus?.connected) ? 'disconnected' : ''}`}>
          <div className="page-card-header">
            <h3 className="page-card-header__title">IMU</h3>
            <div className="page-card-header__actions">
              {showDetail.imu && (
                <label className="toggle-switch" style={{ opacity: (isLoading || !connected || !robotStatus?.connected) ? 0.6 : 1, pointerEvents: (isLoading || !connected || !robotStatus?.connected) ? 'none' : 'auto' }}>
                  <input
                    type="checkbox"
                    checked={imuEnabled}
                    onChange={(e) => handleImuToggle(e.target.checked)}
                    disabled={isLoading || !connected || !robotStatus?.connected}
                  />
                  <span className="toggle-slider"></span>
                </label>
              )}
              {eyeBtn('imu')}
            </div>
          </div>
          {showDetail.imu && (
            <div className="sensor-values">
              <div className="sensor-value" style={{ fontSize: '1.0em', padding: '20px' }}>
                <label style={{ fontSize: '1.2em', fontWeight: 'bold', marginBottom: '10px', display: 'block' }}>消息频率:</label>
                <span style={{
                  fontSize: '2em',
                  fontWeight: 'bold',
                  color: imuEnabled && imuFrequency !== null ? '#10b981' : '#888',
                  display: 'block',
                  textAlign: 'center',
                }}>
                  {imuEnabled && imuFrequency !== null
                    ? `${imuFrequency.toFixed(2)} Hz`
                    : '-'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* 摄像头传感器（预留） */}
        <div className={`sensor-card ${(!connected || !robotStatus?.connected) ? 'disconnected' : ''}`}>
          <div className="page-card-header">
            <h3 className="page-card-header__title">摄像头</h3>
            <div className="page-card-header__actions">
              {showDetail.camera && (
                <label className="toggle-switch" style={{ opacity: (isLoading || !connected || !robotStatus?.connected) ? 0.6 : 1, pointerEvents: (isLoading || !connected || !robotStatus?.connected) ? 'none' : 'auto' }}>
                  <input
                    type="checkbox"
                    checked={cameraEnabled}
                    onChange={(e) => handleCameraToggle(e.target.checked)}
                    disabled={isLoading || !connected || !robotStatus?.connected}
                  />
                  <span className="toggle-slider"></span>
                </label>
              )}
              {eyeBtn('camera')}
            </div>
          </div>
          {showDetail.camera && (
            <div className="sensor-values">
              <div className="sensor-value" style={{ padding: '20px', textAlign: 'center', color: '#888' }}>
                <span>功能预留中，暂无数据显示</span>
              </div>
            </div>
          )}
        </div>

        {/* 激光雷达传感器（预留） */}
        <div className={`sensor-card ${(!connected || !robotStatus?.connected) ? 'disconnected' : ''}`}>
          <div className="page-card-header">
            <h3 className="page-card-header__title">激光雷达</h3>
            <div className="page-card-header__actions">
              {showDetail.lidar && (
                <label className="toggle-switch" style={{ opacity: (isLoading || !connected || !robotStatus?.connected) ? 0.6 : 1, pointerEvents: (isLoading || !connected || !robotStatus?.connected) ? 'none' : 'auto' }}>
                  <input
                    type="checkbox"
                    checked={lidarEnabled}
                    onChange={(e) => handleLidarToggle(e.target.checked)}
                    disabled={isLoading || !connected || !robotStatus?.connected}
                  />
                  <span className="toggle-slider"></span>
                </label>
              )}
              {eyeBtn('lidar')}
            </div>
          </div>
          {showDetail.lidar && (
            <div className="sensor-values">
              <div className="sensor-value" style={{ padding: '20px', textAlign: 'center', color: '#888' }}>
                <span>功能预留中，暂无数据显示</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SensorData;
