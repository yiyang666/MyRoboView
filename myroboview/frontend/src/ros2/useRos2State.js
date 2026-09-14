import { useEffect, useState } from 'react';

export default function useRos2State() {
  const [snapshot, setSnapshot] = useState(null);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let stopped = false, timer, controller;
    async function poll() {
      let interval = 500;
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      try {
        const response = await fetch('/api/v1/state', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!stopped) { setSnapshot(data); setConnected(true); }
        interval = data.poll_ms;
      } catch (_) { if (!stopped) setConnected(false); }
      finally { clearTimeout(timeout); if (!stopped) timer = setTimeout(poll, interval); }
    }
    poll();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, []);
  return { snapshot, connected };
}
