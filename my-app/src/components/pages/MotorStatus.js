import React, { useState, useEffect, useMemo } from 'react';
import './Page.css';
import { getMotorDisplayStatus } from '../../utils/motorStatus';
import { URDF_CONFIG } from '../../config/robotUrdfConfig';

const MotorStatus = ({ robotStatus, sendMessage, addMessageHandler, connected }) => {
  const [motors, setMotors] = useState([]);
  const [, setMotorHealth] = useState(-1);
  const [loading] = useState(false);

  // 产品关节显示名：后端只下发 id + 健康字段，名称由前端 URDF 配置映射
  const jointNameById = useMemo(() => {
    const map = {};
    (URDF_CONFIG.joints || []).forEach((j) => {
      map[Number(j.id)] = j.name;
    });
    return map;
  }, []);

  // 页面订阅：只在机器连接且页面激活时订阅
  useEffect(() => {
    if (robotStatus?.connected && sendMessage) {
      // 订阅电机状态页面
      sendMessage({
        type: 'subscribe',
        data: { page: 'motor_status' }
      });
      
      return () => {
        // 取消订阅
        sendMessage({
          type: 'unsubscribe',
          data: { page: 'motor_status' }
        });
      };
    }
  }, [robotStatus?.connected, sendMessage]);

  // 接收 WebSocket 消息
  useEffect(() => {
    if (!addMessageHandler) return;
    const handleMessage = (data) => {
      if (data.type === 'motor_status_data') {
        if (data.data) {
          if (data.data.motor_health !== undefined) {
            setMotorHealth(data.data.motor_health);
          }
          if (data.data.motors && Array.isArray(data.data.motors)) {
            setMotors(data.data.motors);
          }
        }
      }
    };

    const removeHandler = addMessageHandler(handleMessage);
    return removeHandler;
  }, [addMessageHandler]);

  // 当连接断开或机器人未连接时，重置数据
  useEffect(() => {
    if (!connected || !robotStatus?.connected) {
      setMotors([]);
      setMotorHealth(-1);
    }
  }, [connected, robotStatus?.connected]);

  // 获取在线状态文本和颜色（离线置灰）
  const getOnlineStatus = (online) => {
    return online === 1
      ? { text: 'Online', color: '#10b981' }
      : { text: 'Offline', color: '#6b7280' };
  };

  // 获取电机方向文本
  const getDirectionText = (direction) => {
    return direction === 1 ? '正转' : '反转';
  };

  const getDisplayName = (motor) => {
    const id = Number(motor?.id);
    if (Number.isFinite(id) && jointNameById[id]) {
      return jointNameById[id];
    }
    return motor?.name || `电机 ${motor?.id ?? '?'}`;
  };

  const normalCount = motors.filter((m) => getMotorDisplayStatus(m).text === '正常').length;
  const abnormalCount = motors.filter((m) => getMotorDisplayStatus(m).text === '异常').length;
  const unknownCount = motors.filter((m) => getMotorDisplayStatus(m).text === '未知').length;

  return (
    <div className="page-container">
      <h2 className="page-title">电机状态</h2>
      
      {/* 电机统计信息 */}
      <div
        style={{
          marginBottom: '20px',
          padding: '15px',
          background: 'rgba(255, 255, 255, 0.05)',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          gap: '20px',
          fontSize: '18px'
        }}
      >
        <span style={{ color: '#F8F8FF', fontWeight: 'bold' }}>电机统计（共 {motors.length} 个）：</span>
        <span style={{ color: '#10b981', fontWeight: 'bold' }}>正常：{normalCount} 个</span>
        <span style={{ color: '#f59e0b', fontWeight: 'bold' }}>异常：{abnormalCount} 个</span>
        <span style={{ color: '#6b7280', fontWeight: 'bold' }}>未知：{unknownCount} 个</span>
      </div>

      {/* 电机列表 */}
      <div style={{ background: 'rgba(255, 255, 255, 0.05)', borderRadius: '8px', padding: '10px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>加载中...</div>
        ) : motors.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>
            {connected && robotStatus?.connected ? '等待电机数据...' : '未连接'}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '8px' }}>
            {motors.map((motor, index) => {
              const healthStatus = getMotorDisplayStatus(motor);
              const onlineStatus = getOnlineStatus(motor.u1_online);
              
              return (
                <div
                  key={motor.id || index}
                  style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    borderRadius: '20px',
                    padding: '15px',
                    border: `2px solid ${healthStatus.color}40`,
                    borderLeft: `8px solid ${healthStatus.color}`
                  }}
                >
                  {/* 电机名称和ID */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <div>
                      <span style={{ fontSize: '15px', color: '#888', marginRight: '10px' }}>ID: {motor.id}</span>
                      <span style={{ fontSize: '18px', fontWeight: 'bold', color: '#fff' }}>{getDisplayName(motor)}</span>
                    </div>
                    <div 
                      style={{ position: 'relative', display: 'inline-block', cursor: 'pointer' }}
                      onMouseEnter={(e) => { e.currentTarget.lastChild.style.visibility = 'visible'; e.currentTarget.lastChild.style.opacity = '1'; }}
                      onMouseLeave={(e) => { e.currentTarget.lastChild.style.visibility = 'hidden'; e.currentTarget.lastChild.style.opacity = '0'; }}
                    >
                      <span style={{
                        display: 'inline-block',
                        padding: '5px 30px',
                        borderRadius: '12px',
                        fontSize: '15px',
                        fontWeight: 'bold',
                        backgroundColor: `${healthStatus.color}20`,
                        color: healthStatus.color
                      }}>
                        {healthStatus.text}
                      </span>
                      {/* 弹出的小窗口 */}
                      <div style={{
                        visibility: 'hidden', 
                        opacity: 0, 
                        transition: 'opacity 0.2s',
                        position: 'absolute', 
                        bottom: '100%', 
                        right: '0', 
                        backgroundColor: 'rgba(30, 30, 30, 0.95)', 
                        color: '#fff', 
                        padding: '10px 15px', 
                        borderRadius: '8px',
                        whiteSpace: 'nowrap', 
                        zIndex: 10, 
                        fontSize: '14px', 
                        marginBottom: '8px',
                        boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        lineHeight: '1.5'
                      }}>
                        <div>
                          <span style={{ color: '#888' }}>错误码：</span>
                          <span style={{ color: '#ef4444' }}>
                            {healthStatus.errors}
                          </span>
                        </div>
                        <div>
                          <span style={{ color: '#888' }}>关节版本：</span>
                          <span style={{ color: '#fff' }}>
                            {motor.joint_version || '未知'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 健康状态详情 */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '15px' }}>
                    <div>
                      <span style={{ color: '#b0b0b0' }}>在线状态:</span>
                      <span style={{ color: onlineStatus.color, marginLeft: '8px', fontWeight: 'bold' }}>
                        {onlineStatus.text}
                      </span>
                    </div>
                    <div>
                      <span style={{ color: '#b0b0b0' }}>电机方向:</span>
                      <span style={{ color: '#fff', marginLeft: '8px' }}>
                        {getDirectionText(motor.motor_direction)}
                      </span>
                    </div>
                    <div>
                      <span style={{ color: '#b0b0b0' }}>电机温度:</span>
                      <span style={{ 
                        color: motor.motor_temperature > 60 ? '#ef4444' : motor.motor_temperature > 45 ? '#f59e0b' : '#10b981',
                        marginLeft: '8px',
                        fontWeight: motor.motor_temperature > 60 ? 'bold' : 'normal'
                      }}>
                        {motor.motor_temperature}°C
                      </span>
                    </div>
                    <div>
                      <span style={{ color: '#b0b0b0' }}>MOS温度:</span>
                      <span style={{ 
                        color: motor.mos_temperature > 60 ? '#ef4444' : motor.mos_temperature > 45 ? '#f59e0b' : '#10b981',
                        marginLeft: '8px',
                        fontWeight: motor.mos_temperature > 60 ? 'bold' : 'normal'
                      }}>
                        {motor.mos_temperature}°C
                      </span>
                    </div>
                    <div>
                      <span style={{ color: '#b0b0b0' }}>母线电压:</span>
                      <span style={{ color: '#3b82f6', marginLeft: '8px' }}>
                        {motor.bus_voltage}V
                      </span>
                    </div>
                    <div>
                      <span style={{ color: '#b0b0b0' }}>位置零点:</span>
                      <span style={{ color: '#fff', marginLeft: '8px' }}>
                        {motor.position_zero?.toFixed(2) || '0.00'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default MotorStatus;
