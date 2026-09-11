import { useEffect, useRef, useState } from 'react';
import { DEFAULT_NAV_STATE } from '../constants';

const NAV_TIMEOUT_MS = 3000;

const EMPTY_NAV_PATH = Object.freeze({ frame_id: 'map', points: [] });

const parseNavPathPayload = (data) => {
  const points = Array.isArray(data?.points)
    ? data.points
        .map((p) => ({
          x: Number(p?.x) || 0,
          y: Number(p?.y) || 0,
        }))
        .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    : [];
  return {
    frame_id: data?.frame_id || 'map',
    points,
  };
};

/**
 * 订阅后端 nav_state（page=navigation）
 * - 进页：sendMessage(subscribe) 并开始接收
 * - 离页：sendMessage(unsubscribe)
 * - 断线/超时：仅更新 connectionState；保留 mapping 以便弱网下仍可结束建图
 */
export function useNavState({ sendMessage, addMessageHandler, connected }) {
  const [navState, setNavState] = useState(DEFAULT_NAV_STATE);
  const [connectionState, setConnectionState] = useState('disconnected'); // connected / disconnected / timeout
  const poseRef = useRef({ ...DEFAULT_NAV_STATE.pose });
  const globalPathRef = useRef({ ...EMPTY_NAV_PATH, points: [] });
  const localPathRef = useRef({ ...EMPTY_NAV_PATH, points: [] });
  const lastMsgTimeRef = useRef(null);
  const timeoutTimerRef = useRef(null);
  const subscribedRef = useRef(false);

  // 进页订阅 / 离页取消订阅
  useEffect(() => {
    if (!connected || !sendMessage) return undefined;

    sendMessage({ type: 'subscribe', data: { page: 'navigation' } });
    subscribedRef.current = true;

    return () => {
      if (subscribedRef.current && sendMessage) {
        sendMessage({ type: 'unsubscribe', data: { page: 'navigation' } });
        subscribedRef.current = false;
      }
      globalPathRef.current = { frame_id: 'map', points: [] };
      localPathRef.current = { frame_id: 'map', points: [] };
    };
  }, [connected, sendMessage]);

  // 接收 nav_state / nav_global_path / nav_local_path
  useEffect(() => {
    if (!addMessageHandler) return undefined;

    const handler = (data) => {
      if (data?.type === 'nav_global_path' && data?.data) {
        globalPathRef.current = parseNavPathPayload(data.data);
        return;
      }
      if (data?.type === 'nav_local_path' && data?.data) {
        localPathRef.current = parseNavPathPayload(data.data);
        return;
      }
      if (data?.type !== 'nav_state' || !data?.data) return;

      const d = data.data;
      lastMsgTimeRef.current = Date.now();
      setConnectionState('connected');

      const pose = {
        x: Number(d?.pose?.x) || 0,
        y: Number(d?.pose?.y) || 0,
        z: Number(d?.pose?.z) || 0,
        roll: Number(d?.pose?.roll) || 0,
        pitch: Number(d?.pose?.pitch) || 0,
        yaw: Number(d?.pose?.yaw) || 0,
      };
      const twist = {
        linear: Number(d?.twist?.linear) || 0,
        angular: Number(d?.twist?.angular) || 0,
      };
      const status = d.status || 'IDLE';
      const routePaused = Boolean(d.route_paused);

      poseRef.current = pose;

      setNavState({
        map_name: d.map_name || DEFAULT_NAV_STATE.map_name,
        // task ← current_action；status ← navigation_status
        task: d.task || 'IDLE',
        status,
        route_paused: routePaused,
        loaded_map_id: d.loaded_map_id || '',
        localized: Boolean(d.localized),
        loc_fitness: Number(d.loc_fitness) || 0,
        distance_to_goal: Number(d.distance_to_goal) || 0,
        mapping: d.mapping
          ? {
              active: Boolean(d.mapping.active),
              name: d.mapping.name || '',
              phase: d.mapping.phase || 'idle',
              revision: Number(d.mapping.revision) || 0,
              has_image: Boolean(d.mapping.has_image),
              resolution: Number(d.mapping.resolution) || 0.05,
              origin_x: Number(d.mapping.origin_x) || 0,
              origin_y: Number(d.mapping.origin_y) || 0,
              width: Number(d.mapping.width) || 0,
              height: Number(d.mapping.height) || 0,
              image_url: d.mapping.image_url || '',
              load_error: d.mapping.load_error || '',
              abort_reason: d.mapping.abort_reason || '',
            }
          : { ...DEFAULT_NAV_STATE.mapping },
        active_route_id: d.active_route_id || '',
        current_waypoint_id: d.current_waypoint_id || '',
        active_task_kind: d.active_task_kind || '',
        nav_task_active: Boolean(d.nav_task_active),
        point_goal: d.point_goal
          ? {
              x: Number(d.point_goal.x) || 0,
              y: Number(d.point_goal.y) || 0,
              yaw: Number(d.point_goal.yaw) || 0,
            }
          : null,
        pose,
        twist,
      });
    };

    const remove = addMessageHandler(handler);
    return remove;
  }, [addMessageHandler]);

  // 超时检测
  useEffect(() => {
    if (!connected) {
      setConnectionState('disconnected');
      lastMsgTimeRef.current = null;
      if (timeoutTimerRef.current) {
        clearInterval(timeoutTimerRef.current);
        timeoutTimerRef.current = null;
      }
      return undefined;
    }

    setConnectionState((prev) => (prev === 'connected' ? prev : 'connected'));

    timeoutTimerRef.current = setInterval(() => {
      const last = lastMsgTimeRef.current;
      if (!last) return;
      if (Date.now() - last > NAV_TIMEOUT_MS) {
        setConnectionState('timeout');
      }
    }, 500);

    return () => {
      if (timeoutTimerRef.current) {
        clearInterval(timeoutTimerRef.current);
        timeoutTimerRef.current = null;
      }
    };
  }, [connected]);

  return { navState, poseRef, globalPathRef, localPathRef, connectionState };
}
