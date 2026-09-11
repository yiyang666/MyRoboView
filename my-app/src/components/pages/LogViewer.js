import React, { useState, useEffect, useRef } from 'react';
import './Page.css';

// 日志订阅只依赖 WebSocket 连通；板卡/机器人业务状态不影响本页
const LogViewer = ({ connected, sendMessage, addMessageHandler }) => {
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState('all');
  const [regexFilter, setRegexFilter] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const logEndRef = useRef(null);

  // 页面订阅：WS 连通且本页挂载时即订阅 logs
  useEffect(() => {
    if (connected && sendMessage) {
      // 订阅日志页面
      sendMessage({
        type: 'subscribe',
        data: { page: 'logs' }
      });
      
      return () => {
        // 取消订阅
        sendMessage({
          type: 'unsubscribe',
          data: { page: 'logs' }
        });
      };
    }
  }, [connected, sendMessage]);

  // 接收 WebSocket 消息
  useEffect(() => {
    if (!addMessageHandler) return;
    
    const handleMessage = (data) => {
      if (data.type === 'log_data') {
        const newLog = {
          id: data.data.id,
          timestamp: new Date(data.data.timestamp).toLocaleTimeString(),
          level: data.data.level.toLowerCase(),
          message: data.data.message,
          source: data.data.source || ''
        };
        setLogs(prev => [...prev.slice(-999), newLog]);  // 保持最近1000条
      }
    };
    
    const removeHandler = addMessageHandler(handleMessage);
    return removeHandler;
  }, [addMessageHandler]);

  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  // 日志筛选：级别 + 正则表达式
  const filteredLogs = logs.filter(log => {
    // 级别筛选
    if (filter !== 'all' && log.level !== filter) {
      return false;
    }
    
    // 正则筛选（类似 grep）
    if (regexFilter) {
      try {
        const regex = new RegExp(regexFilter, 'i');  // 不区分大小写
        if (!regex.test(log.message) && !regex.test(log.source)) {
          return false;
        }
      } catch (e) {
        // 正则表达式无效，忽略
        console.warn('Invalid regex pattern:', regexFilter);
      }
    }
    
    return true;
  });

  const getLogLevelClass = (level) => {
    switch (level) {
      case 'error': return 'log-error';
      case 'warn': return 'log-warn';
      case 'info': return 'log-info';
      case 'debug': return 'log-debug';
      default: return '';
    }
  };

  return (
    <div className="page-container">
      <div className="log-header">
        <h2 className="page-title">日志查看</h2>
        <div className="log-controls">
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">ALL</option>
            <option value="info">INFO</option>
            <option value="warn">WARN</option>
            <option value="error">ERROR</option>
            <option value="debug">DEBUG</option>
          </select>
          <input
            type="text"
            placeholder="正则筛选 (如: iot|state)"
            value={regexFilter}
            onChange={(e) => setRegexFilter(e.target.value)}
            style={{ padding: '5px', marginLeft: '10px', width: '200px' }}
          />
          <label>
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            自动滚动
          </label>
          <button onClick={() => setLogs([])}>清空日志</button>
        </div>
      </div>
      <div className="log-container">
        {filteredLogs.length === 0 ? (
          <div className="log-empty">暂无日志</div>
        ) : (
          filteredLogs.map(log => (
            <div key={log.id} className={`log-item ${getLogLevelClass(log.level)}`}>
              <span className="log-timestamp">{log.timestamp}</span>
              <span className="log-level">{log.level.toUpperCase()}</span>
              {log.source && <span className="log-source">[{log.source}]</span>}
              <span className="log-message">{log.message}</span>
            </div>
          ))
        )}
        <div ref={logEndRef} />
      </div>
    </div>
  );
};

export default LogViewer;
