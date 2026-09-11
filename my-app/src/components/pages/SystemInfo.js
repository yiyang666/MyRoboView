import React, { useState, useEffect } from 'react';
import './Page.css';
import { apiFetch } from '../../utils/apiClient';

const SystemInfo = () => {
  const [systemInfo, setSystemInfo] = useState({
    product: 'Unknown',
    platform: 'Unknown',
    robot_type: 'Unknown',
    system_version: 'Unknown',
    app_version: 'Unknown',
    power_version: 'Unknown',
    motor_version: 'Unknown'
  });
  useEffect(() => {
    // 从后端 API 获取系统信息
    const fetchSystemInfo = async () => {
      try {
        const response = await apiFetch('/api/v1/system/info');
        if (response.ok) {
          const data = await response.json();
          // 只更新成功获取的字段，失败时保持默认的 Unknown
          setSystemInfo({
            product: data.product || 'Unknown',
            platform: data.platform || 'Unknown',
            robot_type: data.robot_type || 'Unknown',
            system_version: data.system_version || 'Unknown',
            app_version: data.app_version || 'Unknown',
            power_version: data.power_version || 'Unknown',
            motor_version: data.motor_version || 'Unknown'
          });
        }
        // 如果获取失败，保持默认的 Unknown 值，不显示错误
      } catch (err) {
        // 静默处理错误，保持默认的 Unknown 值
        console.warn('Failed to fetch system info, using default values:', err);
      }
    };

    fetchSystemInfo();
  }, []);

  return (
    <div style={{ padding: '0', height: '100%', overflow: 'auto' }}>
      <h2 className="page-title" style={{ marginBottom: '20px',marginTop:'20px'}}>系统信息</h2>
      
      <div className="info-grid" style={{ gridTemplateColumns: '1fr' }}>
        <div className="info-card">
          <h3>产品名称</h3>
          <div className="info-value" style={{ 
            color: systemInfo.product === 'Unknown' ? '#888' : '#fff' 
          }}>
            {systemInfo.product}
          </div>
        </div>

        <div className="info-card">
          <h3>平台</h3>
          <div className="info-value" style={{ 
            color: systemInfo.platform === 'Unknown' ? '#888' : '#fff' 
          }}>
            {systemInfo.platform}
          </div>
        </div>

        <div className="info-card">
          <h3>机器人类型</h3>
          <div className="info-value" style={{ 
            color: systemInfo.robot_type === 'Unknown' ? '#888' : '#fff' 
          }}>
            {systemInfo.robot_type}
          </div>
        </div>

        <div className="info-card">
          <h3>系统版本</h3>
          <div className="info-value" style={{ 
            color: systemInfo.system_version === 'Unknown' ? '#888' : '#fff' 
          }}>
            {systemInfo.system_version}
          </div>
        </div>

        <div className="info-card">
          <h3>应用版本</h3>
          <div className="info-value" style={{ 
            color: systemInfo.app_version === 'Unknown' ? '#888' : '#fff' 
          }}>
            {systemInfo.app_version}
          </div>
        </div>

        <div className="info-card">
          <h3>电源版本</h3>
          <div className="info-value" style={{ 
            color: systemInfo.power_version === 'Unknown' ? '#888' : '#fff' 
          }}>
            {systemInfo.power_version}
          </div>
        </div>

        <div className="info-card">
          <h3>电机版本</h3>
          <div className="info-value" style={{ 
            color: systemInfo.motor_version === 'Unknown' ? '#888' : '#fff' 
          }}>
            {systemInfo.motor_version}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SystemInfo;
