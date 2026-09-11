import React, { useCallback, useState, useEffect, useRef } from 'react';
import { Routes, Route, useLocation, Navigate } from 'react-router-dom';
import './App.css';
import Sidebar from './components/Sidebar';
import StatusBar from './components/StatusBar';
import Robot3DView from './components/Robot3DView';
import SensorData from './components/pages/SensorData';
import RobotControl from './components/pages/RobotControl';
import JointControl from './components/pages/JointControl';
import LogViewer from './components/pages/LogViewer';
import LogDownload from './components/pages/LogDownload';
import SystemInfo from './components/pages/SystemInfo';
import ResourceMonitor from './components/pages/ResourceMonitor';
import MotorStatus from './components/pages/MotorStatus';
import MapNavigation from './components/pages/MapNavigation';
import ConnectionErrorModal from './components/ConnectionErrorModal';
import OperatorApp from './components/operator';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './components/pages/Login';
import { useWebSocket } from './hooks/useWebSocket';
import { useOperatorShell } from './hooks/useOperatorShell';
import { useInputMode } from './hooks/useInputMode';
import { getWebSocketUrlWithAuth } from './utils/apiClient';
import { useAuth } from './context/AuthContext';
import { hasFeature } from './config/productFeatures';

// 默认状态：未与机器人后端服务连接时显示的默认值（由前端控制）
const DEFAULT_ROBOT_STATUS = {
  connected: false,
  connectionState: 'disconnected', // 'connected', 'disconnected', 'timeout'

  status: 'Unknown',
  mode: 'Unknown',
  action: 'Unknown',
  running_status: 'Unknown',
  motor_health: 'Unknown',

  battery_voltage: 0.0,
  battery_current: 0.0,
  remaining_power: 0,
  startup_cnt:0,
  battery_state:0,
  current_temp:0,
  battery_errcode:0,
  // position: { x: 0, y: 0, theta: 0 }
};

// 数据超时时间（毫秒）：如果超过这个时间没有收到数据，认为连接异常，恢复默认状态
const DATA_TIMEOUT_MS = 8000; // 8秒

// joint_state 包间 LERP 默认 T（ms），收包后由后端 interval_ms 覆盖
const JOINT_LERP_T_FALLBACK_MS = 20;

const roundJointRad = (value) => Math.round(value * 10000) / 10000;

function MainApp() {
  const { isAdmin } = useAuth();
  // 组合根分叉：会话仍在本组件，避免把 WebSocket 再抽一层
  const isOperatorShell = useOperatorShell();
  const location = useLocation();
  // 地图导航页：整页替换 URDF + 系统信息 + 下方功能区（需产品开启 mapNavigation）
  const canMapNavigation = hasFeature('mapNavigation');
  const isNavigationMode = canMapNavigation && location.pathname === '/navigation';
  const [selectedMenu, setSelectedMenu] = useState('control');
  // 使用默认状态初始化
  const [robotStatus, setRobotStatus] = useState(DEFAULT_ROBOT_STATUS);
  // 关节控制页滑块关节角（弧度，仅前端 URDF 3D 演示用，不发给后端）
  const [jointAnglesForView, setJointAnglesForView] = useState({});
  // 关节状态（方案B）：后端下发 { id: 'ok'|'warning'|'offline' }，前端仅做颜色映射，不做业务判定
  const [jointStatusForView, setJointStatusForView] = useState({});
  // URDF 关节角来源模式：follow=跟随后端反馈；slider=仅在 JointControl 页面自由控制
  const [jointAngleMode, setJointAngleMode] = useState('follow');
  // 包间 LERP 段：{ [id]: { from, to, t0 } }，t0 为收包时刻（performance.now）
  const jointLerpSegmentsRef = useRef({});
  // LERP 周期 T（ms），与后端 roboview.yaml motor_action_feedback_interval 一致
  const jointLerpIntervalMsRef = useRef(JOINT_LERP_T_FALLBACK_MS);
  // 前端平滑后的关节角（弧度）：用 ref 存，raf 驱动 setState
  const jointAnglesSmoothedRef = useRef({}); // { [id]: angleRad }
  const wsConnectedRef = useRef(false);
  
  // 用于跟踪最后收到数据的时间
  const lastDataTimeRef = useRef(null);
  const timeoutTimerRef = useRef(null);
  // 用于跟踪是否曾经连接成功过（区分"从未连接"和"连接后断开"）
  const hasConnectedRef = useRef(false);
  
  // 窗口大小调整状态（固定8:2布局，不再需要水平分割）
  const [verticalSplit, setVerticalSplit] = useState(50); // 上下分割（默认50%）
  const [isResizingVertical, setIsResizingVertical] = useState(false);
  const contentAreaRef = useRef(null);
  
  // 连接异常弹窗状态
  const [errorModal, setErrorModal] = useState({
    isOpen: false,
    errorType: null // 'websocket_disconnected' 或 'data_timeout'
  });

  // 设置/重置数据超时定时器：在 DATA_TIMEOUT_MS 内没收到任何 robot_state 则进入 timeout
  // 注意：connected(来自 useWebSocket) 表示 WS 是否连通；robotStatus.connected 表示 robot(lyos) 是否连通
  const armDataTimeoutTimer = useCallback(() => {
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
    if (!wsConnectedRef.current) return;

    timeoutTimerRef.current = setTimeout(() => {
      console.warn('[App] No robot_state data received for', DATA_TIMEOUT_MS, 'ms, data timeout');

      // 超时：不清空现有字段（保留后端初始状态/上次状态），只标记 connectionState=timeout
      setRobotStatus(prev => ({
        ...prev,
        connectionState: 'timeout'
      }));

      setErrorModal(prev => {
        if (!prev.isOpen) {
          return { isOpen: true, errorType: 'data_timeout' };
        }
        return prev;
      });
    }, DATA_TIMEOUT_MS);
  }, []);

  const handleWebSocketMessage = (data) => {
    // 只处理 robot_state 消息的超时检测
    // 其他消息（sensor_data, monitor_data, log_data）由各自页面组件处理，不影响超时检测
    if (data.type === 'robot_state') {
      // 更新最后收到状态数据的时间
      lastDataTimeRef.current = Date.now();
      // 收到 robot_state，重置超时定时器
      armDataTimeoutTimer();
      
      if (!data.data) {
        console.warn('[App] Received robot_state message without data');
        return;
      }
      
      // 辅助函数：处理字段值
      // - undefined: 未收到数据 -> 使用默认值
      // - null 或 '': 收到但为空 -> 'Null'
      // - 其他值: 正常值
      const getFieldValue = (value, defaultValue) => {
        if (value === undefined) return defaultValue;  // 未收到数据，使用默认值
        if (value === null || value === '') return 'Null';  // 收到但为空
        return value;  // 正常值
      };
      
      // 说明：这里有两个 connected 的概念
      // 1. data.data.connected (第82行) - 来自 robot_state 消息，表示机器人（lyos）是否连接
      // 2. connected (第102行) - 来自 useWebSocket hook，表示 WebSocket 连接状态
      // 超时检测基于 robot_state 消息，但需要 WebSocket 连接正常才能设置超时定时器
      
      const robotConnected = Boolean(data.data.connected);

      // 注意：即使 robotConnected=false，也要把后端发来的“初始状态/缓存状态”显示出来
      // 不能直接回到 DEFAULT_ROBOT_STATUS，否则你会看不到后端初始状态（你指出的 bug）
      setRobotStatus(prev => ({
        ...prev,
        connected: robotConnected, // 仅表示 robot(lyos) 是否连接
        connectionState: robotConnected ? 'connected' : 'disconnected',
        status: getFieldValue(data.data.status, prev.status),
        mode: getFieldValue(data.data.mode, prev.mode),
        action: getFieldValue(data.data.action, prev.action),
        running_status: getFieldValue(data.data.running_status, prev.running_status),
        motor_health: getFieldValue(data.data.motor_health, prev.motor_health),
        // 电池相关：优先使用后端维护的电池信息
        battery_voltage: data.data.battery_voltage !== undefined ? data.data.battery_voltage : prev.battery_voltage,
        battery_current: data.data.battery_current !== undefined ? data.data.battery_current : prev.battery_current,
        remaining_power: data.data.remaining_power !== undefined ? data.data.remaining_power : prev.remaining_power,
        startup_cnt: data.data.startup_cnt !== undefined ? data.data.startup_cnt : prev.startup_cnt,
        battery_state: data.data.battery_state !== undefined ? data.data.battery_state : prev.battery_state,
        current_temp: data.data.current_temp !== undefined ? data.data.current_temp : prev.current_temp,
        battery_errcode: data.data.battery_errcode !== undefined ? data.data.battery_errcode : prev.battery_errcode,
        // joints: data.data.joints !== undefined ? data.data.joints : prev.joints,
        // position: data.data.position !== undefined ? data.data.position : prev.position
      }));

      // 如果之前是超时状态，现在又收到了 robot_state，则关闭超时弹窗
      setErrorModal(prev => {
        if (prev.errorType === 'data_timeout') {
          return { isOpen: false, errorType: null };
        }
        return prev;
      });
    } else if (data.type === 'joint_state') {
      // 后端电机反馈 -> 建立包间 LERP 段（用于 URDF 平滑跟随）
      const joints = data?.data?.joints;
      if (!Array.isArray(joints)) return;

      const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const intervalMs = Number(data?.data?.interval_ms);
      if (Number.isFinite(intervalMs) && intervalMs > 0) {
        jointLerpIntervalMsRef.current = intervalMs;
      }

      const display = jointAnglesSmoothedRef.current || {};
      const segments = { ...jointLerpSegmentsRef.current };

      joints.forEach((j) => {
        const id = Number(j.id);
        if (!Number.isFinite(id)) return;
        if (typeof j.position_rad !== 'number') return;

        const to = j.position_rad;
        const from = display[id] != null ? display[id] : to;
        segments[id] = { from, to, t0: nowMs };
      });

      if (Object.keys(segments).length > 0) {
        jointLerpSegmentsRef.current = segments;
      }
    } else if (data.type === 'motor_status_data') {
      // 后端统一广播电机明细 + status/error_code，主页 3D 圆环与详情页共用
      const motors = data?.data?.motors;
      if (!Array.isArray(motors)) return;

      const next = {};
      motors.forEach((m) => {
        const id = Number(m.id);
        if (!Number.isFinite(id)) return;
        if (typeof m.status === 'string') {
          next[id] = m.status;
        }
      });
      setJointStatusForView(next);
    }
    // sensor_data, monitor_data, log_data 由各自页面组件处理，不影响超时检测
  };

  const { connected, sendMessage, addMessageHandler } = useWebSocket({
    url: getWebSocketUrlWithAuth(),
    onMessage: handleWebSocketMessage
  });

  // 桌面顶栏与现场壳共用：REST 初值 + 控制页切换写回
  const { inputMode, setInputMode, inputModeReady } = useInputMode();

  useEffect(() => {
    wsConnectedRef.current = connected;
  }, [connected, armDataTimeoutTimer]);

  // follow 模式：包间线性插值（T = 后端配置的广播间隔）
  // 遥控壳不挂载 3D，跳过 RAF 以省电
  useEffect(() => {
    if (isOperatorShell || jointAngleMode !== 'follow') return;

    let raf = 0;
    // web api: requestAnimationFrame定时器，每秒60次（显示器帧率）调用tick函数，实现平滑动画效果
    const tick = () => {
      const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const segments = jointLerpSegmentsRef.current || {};
      const T = jointLerpIntervalMsRef.current;
      const nextAngles = {};
      // 遍历所有关节的插值段，计算每个关节的当前角度（from）和目标角度（to）之间的插值
      Object.entries(segments).forEach(([idStr, seg]) => {
        const id = Number(idStr);
        if (!Number.isFinite(id) || !seg) return;

        const elapsed = Math.max(0, nowMs - seg.t0);
        const alpha = Math.min(1, elapsed / T);
        nextAngles[id] = roundJointRad(seg.from + (seg.to - seg.from) * alpha);
      });

      if (Object.keys(nextAngles).length > 0) {
        jointAnglesSmoothedRef.current = nextAngles;
        setJointAnglesForView(nextAngles);
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isOperatorShell, jointAngleMode]);

  // 当 WebSocket 连接状态变化时，处理超时检测
  useEffect(() => {
    if (!connected) {
      // WebSocket 断开时
      // 只有在曾经连接成功过的情况下，才认为是真正的断开，需要弹出错误弹窗
      if (hasConnectedRef.current) {
        // 曾经连接成功过，现在断开了，这是真正的断开
        console.log('[App] WebSocket disconnected, resetting to default state');
        setRobotStatus({ 
          ...DEFAULT_ROBOT_STATUS,
          connectionState: 'disconnected' // 明确标记为断开状态
        });
        // 清除超时定时器
        if (timeoutTimerRef.current) {
          clearTimeout(timeoutTimerRef.current);
          timeoutTimerRef.current = null;
        }
        lastDataTimeRef.current = null;
        jointLerpSegmentsRef.current = {};
        jointLerpIntervalMsRef.current = JOINT_LERP_T_FALLBACK_MS;
        jointAnglesSmoothedRef.current = {};
        setJointAnglesForView({});
        setJointStatusForView({}); // 断开后清空关节状态，避免残留旧着色
        // 只在弹窗未打开时才弹出新的错误弹窗（避免重复弹出）
        setErrorModal(prev => {
          if (!prev.isOpen || prev.errorType !== 'websocket_disconnected') {
            return {
              isOpen: true,
              errorType: 'websocket_disconnected'
            };
          }
          return prev; // 如果弹窗已经打开且是相同类型，保持当前状态
        });
      }
      // 如果从未连接成功过（初始状态），不弹出错误弹窗，因为可能正在连接中
    } else {
      // 连接建立时，标记为已连接成功
      hasConnectedRef.current = true;
      // 等待 robot_state（包括后端的初始状态）；如果一直收不到则触发 timeout
      lastDataTimeRef.current = null;
      
      // 清除之前的超时定时器（如果有）
      if (timeoutTimerRef.current) {
        clearTimeout(timeoutTimerRef.current);
        timeoutTimerRef.current = null;
      }

      // WS 连上后立即开始超时计时（处理“domain 不同导致根本收不到状态”）
      armDataTimeoutTimer();
      
      // 关闭数据超时错误弹窗（如果是因为数据超时导致的）
      setErrorModal(prev => {
        if (prev.errorType === 'data_timeout') {
          return { isOpen: false, errorType: null };
        }
        return prev;
      });
      
      // 注意：后续每次收到 robot_state，handleWebSocketMessage 会重置超时定时器
    }
    
    // 清理函数
    return () => {
      if (timeoutTimerRef.current) {
        clearTimeout(timeoutTimerRef.current);
        timeoutTimerRef.current = null;
      }
    };
  }, [connected, armDataTimeoutTimer]);


  // 处理垂直分割条拖拽（上下分割）
  const handleVerticalMouseDown = (e) => {
    setIsResizingVertical(true);
    e.preventDefault();
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isResizingVertical && contentAreaRef.current) {
        const container = contentAreaRef.current;
        const rect = container.getBoundingClientRect();
        const newPosition = ((e.clientY - rect.top) / rect.height) * 100;
        setVerticalSplit(Math.max(20, Math.min(80, newPosition)));
      }
    };

    const handleMouseUp = () => {
      setIsResizingVertical(false);
    };

    if (isResizingVertical) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isResizingVertical]);

  if (isOperatorShell) {
    return (
      <OperatorApp
        robotStatus={robotStatus}
        inputMode={inputMode}
        setInputMode={setInputMode}
        inputModeReady={inputModeReady}
        connected={connected}
        sendMessage={sendMessage}
        addMessageHandler={addMessageHandler}
        errorModal={errorModal}
        onCloseError={() => setErrorModal({ isOpen: false, errorType: null })}
      />
    );
  }

  // 无导航能力时拦截深链 /navigation，避免假可用
  if (!canMapNavigation && location.pathname === '/navigation') {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="app-container">
        <Sidebar 
          selectedMenu={selectedMenu} 
          onMenuSelect={setSelectedMenu} 
        />
        <div className="main-content">
          <StatusBar 
            robotStatus={robotStatus}
            inputMode={inputMode}
            connected={connected}
          />
          <div className="content-area" ref={contentAreaRef}>
            {isNavigationMode ? (
              <div className="navigation-section">
                <MapNavigation sendMessage={sendMessage} addMessageHandler={addMessageHandler} connected={connected} robotStatus={robotStatus} />
              </div>
            ) : (
              <>
                <div className="top-section" style={{ height: `${verticalSplit}%` }}>
                  <div className="top-section-content">
                    <div className="robot-view-container" style={{ width: '70%' }}>
                      <Robot3DView 
                        jointAnglesForView={jointAnglesForView}
                        jointStatus={jointStatusForView}
                      />
                    </div>
                    <div className="system-info-container" style={{ width: '30%' }}>
                      <SystemInfo />
                    </div>
                  </div>
                </div>
                <div 
                  className="vertical-splitter"
                  onMouseDown={handleVerticalMouseDown}
                  style={{ cursor: 'row-resize' }}
                />
                <div className="bottom-section" style={{ height: `${100 - verticalSplit}%` }}>
                  <Routes>
                    <Route path="/" element={<MotorStatus robotStatus={robotStatus} sendMessage={sendMessage} addMessageHandler={addMessageHandler} connected={connected} />} />
                    <Route path="/motor" element={<MotorStatus robotStatus={robotStatus} sendMessage={sendMessage} addMessageHandler={addMessageHandler} connected={connected} />} />
                    <Route path="/control" element={<RobotControl robotStatus={robotStatus} sendMessage={sendMessage} addMessageHandler={addMessageHandler} connected={connected} inputMode={inputMode} setInputMode={setInputMode} inputModeReady={inputModeReady} />} />
                    <Route
                      path="/joints"
                      element={
                        <JointControl
                          jointAnglesForView={jointAnglesForView}
                          onJointAnglesChange={setJointAnglesForView}
                          jointAngleMode={jointAngleMode}
                          onJointAngleModeChange={setJointAngleMode}
                          showMotorCalibrate={isAdmin}
                        />
                      }
                    />
                    <Route path="/sensor" element={<SensorData robotStatus={robotStatus} sendMessage={sendMessage} addMessageHandler={addMessageHandler} connected={connected} />} />
                    {/* 监控订阅只依赖 WS 连通，不依赖机器人业务在线状态 */}
                    <Route path="/monitor" element={<ResourceMonitor sendMessage={sendMessage} addMessageHandler={addMessageHandler} connected={connected} />} />
                    {/* 日志订阅只依赖 WS 连通，不依赖机器人业务在线状态 */}
                    <Route path="/logs" element={<LogViewer connected={connected} sendMessage={sendMessage} addMessageHandler={addMessageHandler} />} />
                    <Route path="/download" element={<LogDownload />} />
                  </Routes>
                </div>
              </>
            )}
          </div>
        </div>
        <ConnectionErrorModal
          isOpen={errorModal.isOpen}
          errorType={errorModal.errorType}
          onClose={() => setErrorModal({ isOpen: false, errorType: null })}
        />
      </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <MainApp />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
