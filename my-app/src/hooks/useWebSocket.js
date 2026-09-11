import { useState, useEffect, useRef, useCallback } from 'react';

export const useWebSocket = ({ url, onMessage, reconnectInterval = 30000, maxReconnectAttempts = 10 }) => {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const wsRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef(null);
  const messageHandlersRef = useRef([]);
  
  // 使用 ref 保存最新的 onMessage，避免依赖变化导致重连
  const onMessageRef = useRef(onMessage);
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);
  
  // 注册消息处理器（支持多个处理器）
  const addMessageHandler = useCallback((handler) => {
    messageHandlersRef.current.push(handler);
    return () => {
      messageHandlersRef.current = messageHandlersRef.current.filter(h => h !== handler);
    };
  }, []);

  const connect = useCallback(() => {
    // 如果已经连接或正在连接，不重复连接
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.CONNECTING || 
          wsRef.current.readyState === WebSocket.OPEN) {
        console.log('[WebSocket] Already connecting/connected, skipping');
        return;
      }
    }

    try {
      console.log(`[WebSocket] Connecting to ${url}...`);
      const ws = new WebSocket(url);
      
      ws.onopen = () => {
        console.log(`[WebSocket] Connected to ${url}`);
        setConnected(true);
        setError(null);
        reconnectAttemptsRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // 使用 ref 获取最新的 onMessage
          if (onMessageRef.current) {
            onMessageRef.current(data);
          }
          // 调用所有注册的处理器
          messageHandlersRef.current.forEach(handler => {
            try {
              handler(data);
            } catch (err) {
              console.error('[WebSocket] Error in message handler:', err);
            }
          });
        } catch (err) {
          console.error('[WebSocket] Failed to parse message:', err);
        }
      };

      ws.onerror = (error) => {
        console.error('[WebSocket] Connection error:', error);
        setError('WebSocket connection error');
      };

      ws.onclose = (event) => {
        console.log(`[WebSocket] Disconnected (code: ${event.code})`);
        setConnected(false);
        
        // 清理引用
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
        
        // 尝试重连（只有在非正常关闭时）
        if (event.code !== 1000 && reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current += 1;
          console.log(`[WebSocket] Reconnecting (${reconnectAttemptsRef.current}/${maxReconnectAttempts})...`);
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, reconnectInterval);
        } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
          console.error('[WebSocket] Max reconnection attempts reached');
          setError('Max reconnection attempts reached');
        }
      };

      wsRef.current = ws;
    } catch (err) {
      console.error('[WebSocket] Failed to create connection:', err);
      setError(err.message);
    }
  }, [url, reconnectInterval, maxReconnectAttempts]);  // 不依赖 onMessage，避免频繁重连

  const sendMessage = useCallback((message) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify(message));
        return true;
      } catch (err) {
        console.error('[WebSocket] Failed to send message:', err);
        setError('Failed to send message');
        return false;
      }
    } else {
      console.warn('[WebSocket] Not connected, cannot send message');
      setError('WebSocket is not connected');
      return false;
    }
  }, []);

  const disconnect = useCallback(() => {
    console.log('[WebSocket] Disconnecting...');
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close(1000, 'Manual disconnect');  // 正常关闭
      wsRef.current = null;
    }
    setConnected(false);
  }, []);

  useEffect(() => {
    connect();
    return () => {
      console.log('[WebSocket] Cleaning up connection...');
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounting');  // 正常关闭
        wsRef.current = null;
      }
      setConnected(false);
    };
  }, [connect]);  // connect 已包含 url 等依赖，避免漏依赖告警

  return {
    connected,
    error,
    sendMessage,
    disconnect,
    reconnect: connect,
    addMessageHandler
  };
};
