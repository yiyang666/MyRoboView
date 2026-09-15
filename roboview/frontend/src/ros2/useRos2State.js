import { useEffect, useState } from 'react';

export default function useRos2State() {
  const [snapshot, setSnapshot] = useState(null);
  const [navState, setNavState] = useState(null);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let stopped = false, socket, retry, lastFrame = 0, controller;
    const connect = async () => {
      // The development proxy installs its upgrade handler on the first HTTP request.
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      try {
        const response = await fetch('/api/v1/health', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Service unavailable');
      } catch (_) {
        if (!stopped) { setConnected(false); retry = setTimeout(connect, 1000); }
        return;
      } finally { clearTimeout(timeout); }
      if (stopped) return;
      lastFrame = Date.now();
      socket = new WebSocket(`${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/api/v1/telemetry`);
      socket.onmessage = event => {
        if (stopped) return;
        try {
          const frame = JSON.parse(event.data);
          lastFrame = Date.now();
          if (frame.type === 'hello') { setSnapshot(frame.snapshot); setNavState(null); setConnected(true); }
          else if (frame.type === 'nav_state') setNavState(frame.data);
          else if (frame.topic_id) setSnapshot(previous => previous && ({ ...previous,
            topics: previous.topics.map(topic => topic.id === frame.topic_id ? { ...topic,
              state: frame.state, age_sec: frame.age_sec, count: frame.received_count,
              hz: frame.receive_hz, error: frame.error, data: frame.data } : topic) }));
        } catch (_) { socket.close(); }
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => { if (!stopped) { setConnected(false); retry = setTimeout(connect, 1000); } };
    };
    connect();
    const watchdog = setInterval(() => {
      // Configuration permits broadcasts as slow as 0.1 Hz.
      if (lastFrame && Date.now() - lastFrame > 15000) { setConnected(false); socket?.close(); }
    }, 1000);
    return () => { stopped = true; clearTimeout(retry); clearInterval(watchdog); controller?.abort(); socket?.close(); };
  }, []);
  return { snapshot, navState, connected };
}
