/*
 * @Author: ethan.young Ethan.Yang2@lingyiitech.com
 * @Date: 2026-01-30 14:30:40
 * @LastEditors: ethan.young Ethan.Yang2@lingyiitech.com
 * @LastEditTime: 2026-02-02 14:20:13
 * @FilePath: /build_all/src/roboview/my-app/src/components/ConnectionErrorModal.js
 * @Description: 
 */
import React from 'react';
import './ConnectionErrorModal.css';

const ConnectionErrorModal = ({ isOpen, errorType, onClose }) => {
  if (!isOpen) return null;

  const getErrorInfo = () => {
    if (errorType === 'websocket_disconnected') {
      return {
        title: '后端服务断开...',
        message: 'WebSocket 连接已断开，无法与后端服务通信。',
        details: '可能的原因：后端服务崩溃、网络中断或服务器关闭。',
        color: '#ef4444' // 红色
      };
    } else if (errorType === 'data_timeout') {
      return {
        title: '数据接收超时...',
        message: '超过 8 秒未收到机器人状态数据。',
        details: '可能的原因：后端与机器人连接断开、机器人状态服务未运行或网络延迟。',
        color: '#f59e0b' // 黄色
      };
    }
    return {
      title: '连接异常',
      message: '未知的连接错误。',
      details: '',
      color: '#ef4444'
    };
  };

  const errorInfo = getErrorInfo();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header" style={{ borderBottomColor: errorInfo.color }}>
          <h3 className="modal-title" style={{ color: errorInfo.color }}>
            {errorInfo.title}
          </h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <p className="modal-message">{errorInfo.message}</p>
          <p className="modal-details">{errorInfo.details}</p>
        </div>
        <div className="modal-footer">
          <button className="modal-button" onClick={onClose} style={{ backgroundColor: errorInfo.color }}>
            知道了
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConnectionErrorModal;
