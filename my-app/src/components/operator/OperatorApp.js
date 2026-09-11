import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import ConnectionErrorModal from '../ConnectionErrorModal';
import RobotControl from '../pages/RobotControl';
import { INPUT_MODES } from '../pages/RobotControl/inputModes';
import OperatorHeader from './OperatorHeader';
import OperatorHome from './home/OperatorHome';
import OperatorMapNavigation from './navigation/OperatorMapNavigation';
import { hasFeature } from '../../config/productFeatures';
import './OperatorApp.css';

/**
 * 手机现场壳根组件：中台 + 遥控 +（可选）导航
 * 与桌面 MainApp 平行，不包含侧栏 / 3D / 监控页
 */
export default function OperatorApp({
  robotStatus,
  inputMode = INPUT_MODES.IOT,
  setInputMode,
  inputModeReady = true,
  connected,
  sendMessage,
  addMessageHandler,
  errorModal,
  onCloseError,
}) {
  const canMapNavigation = hasFeature('mapNavigation');

  return (
    <div className="operator-app">
      <Routes>
        <Route
          path="/operator"
          element={<OperatorHome robotStatus={robotStatus} inputMode={inputMode} />}
        />
        <Route
          path="/operator/control"
          element={
            <div className="operator-app__page">
              <OperatorHeader
                robotStatus={robotStatus}
                inputMode={inputMode}
                title="遥控模式"
                showBack
              />
              <main className="operator-app__main">
                <RobotControl
                  variant="operator"
                  robotStatus={robotStatus}
                  sendMessage={sendMessage}
                  addMessageHandler={addMessageHandler}
                  connected={connected}
                  inputMode={inputMode}
                  setInputMode={setInputMode}
                  inputModeReady={inputModeReady}
                />
              </main>
            </div>
          }
        />
        <Route
          path="/operator/nav"
          element={
            canMapNavigation ? (
              <OperatorMapNavigation
                robotStatus={robotStatus}
                inputMode={inputMode}
                sendMessage={sendMessage}
                addMessageHandler={addMessageHandler}
                connected={connected}
              />
            ) : (
              <Navigate to="/operator" replace />
            )
          }
        />
        {/* 兼容旧链接 /control */}
        <Route path="/control" element={<Navigate to="/operator/control" replace />} />
        <Route path="*" element={<Navigate to="/operator" replace />} />
      </Routes>
      <ConnectionErrorModal
        isOpen={errorModal.isOpen}
        errorType={errorModal.errorType}
        onClose={onCloseError}
      />
    </div>
  );
}
