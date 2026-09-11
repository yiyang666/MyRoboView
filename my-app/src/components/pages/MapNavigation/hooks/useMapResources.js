import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../../../utils/apiClient';

const emptyResources = {
  loadedMapId: '',
  activeMap: null,
  maps: [],
  waypoints: [],
  routes: [],
};

const normalizeMap = (map) => {
  if (!map) return null;
  return {
    id: map.id,
    name: map.name,
    imageUrl: map.image_url || '',
    source: map.source || 'offline',
    resolution: Number(map.resolution) || 0.05,
    originX: Number(map.origin_x) || 0,
    originY: Number(map.origin_y) || 0,
    width: Number(map.width) || 0,
    height: Number(map.height) || 0,
    // 后端字段是 wall_thickness；画布组件沿用 wallThickness
    wallThickness: Number(map.wall_thickness) || 0.2,
  };
};

/**
 * 地图资源统一读取层：
 * - 地图列表由后端维护
 * - 当前地图的目标点 / 线路跟随“已加载地图”读取
 * - 前端只缓存当前页展示所需资源
 */
export function useMapResources() {
  const [maps, setMaps] = useState([]);
  const [loadedMapId, setLoadedMapId] = useState('');
  const [activeMap, setActiveMap] = useState(null);
  const [waypoints, setWaypoints] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [loadingMaps, setLoadingMaps] = useState(false);
  const [loadingResources, setLoadingResources] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState('');

  const refreshMaps = useCallback(async () => {
    setLoadingMaps(true);
    setError('');
    try {
      const response = await apiFetch('/api/v1/nav/maps');
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      const nextMaps = Array.isArray(data.maps)
        ? data.maps.map(normalizeMap).filter(Boolean)
        : [];
      setMaps(nextMaps);
      setLoadedMapId(data.loaded_map_id || '');
      return {
        maps: nextMaps,
        loadedMapId: data.loaded_map_id || '',
      };
    } catch (err) {
      setError(err.message || '加载地图列表失败');
      return emptyResources;
    } finally {
      setLoadingMaps(false);
    }
  }, []);

  const refreshCurrentResources = useCallback(async () => {
    setLoadingResources(true);
    setError('');
    try {
      const response = await apiFetch('/api/v1/nav/maps/current/resources');
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      const nextMap = normalizeMap(data.map);
      setLoadedMapId(data.loaded_map_id || '');
      setActiveMap(nextMap);
      setWaypoints(Array.isArray(data.waypoints) ? data.waypoints : []);
      setRoutes(Array.isArray(data.routes) ? data.routes : []);
      return {
        loadedMapId: data.loaded_map_id || '',
        activeMap: nextMap,
        waypoints: Array.isArray(data.waypoints) ? data.waypoints : [],
        routes: Array.isArray(data.routes) ? data.routes : [],
      };
    } catch (err) {
      setError(err.message || '加载地图资源失败');
      setActiveMap(null);
      setWaypoints([]);
      setRoutes([]);
      return emptyResources;
    } finally {
      setLoadingResources(false);
    }
  }, []);

  useEffect(() => {
    // 页面首次进入时同步一次地图列表和当前已加载地图资源
    refreshMaps().then(() => {
      refreshCurrentResources();
    });
  }, [refreshMaps, refreshCurrentResources]);

  const loadMap = useCallback(
    async (mapId) => {
      if (!mapId) return false;
      setMutating(true);
      setError('');
      try {
        const response = await apiFetch('/api/v1/nav/maps/load', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ map_id: mapId }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) {
          throw new Error(data.error || `HTTP ${response.status}`);
        }
        await refreshMaps();
        await refreshCurrentResources();
        return true;
      } catch (err) {
        setError(err.message || '加载地图失败');
        return false;
      } finally {
        setMutating(false);
      }
    },
    [refreshCurrentResources, refreshMaps]
  );

  const deleteMap = useCallback(
    async (mapId) => {
      if (!mapId) return false;
      setMutating(true);
      setError('');
      try {
        const response = await apiFetch(`/api/v1/nav/maps/${encodeURIComponent(mapId)}`, {
          method: 'DELETE',
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) {
          throw new Error(data.error || `HTTP ${response.status}`);
        }
        await refreshMaps();
        await refreshCurrentResources();
        return true;
      } catch (err) {
        setError(err.message || '删除地图失败');
        return false;
      } finally {
        setMutating(false);
      }
    },
    [refreshCurrentResources, refreshMaps]
  );

  const createWaypoint = useCallback(
    async (payload) => {
      setMutating(true);
      setError('');
      try {
        const response = await apiFetch('/api/v1/nav/waypoints', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) {
          throw new Error(data.error || `HTTP ${response.status}`);
        }
        await refreshCurrentResources();
        return true;
      } catch (err) {
        setError(err.message || '新增目标点失败');
        return false;
      } finally {
        setMutating(false);
      }
    },
    [refreshCurrentResources]
  );

  const deleteWaypoint = useCallback(
    async (waypointId) => {
      setMutating(true);
      setError('');
      try {
        const response = await apiFetch(
          `/api/v1/nav/waypoints/${encodeURIComponent(waypointId)}`,
          { method: 'DELETE' }
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) {
          throw new Error(data.error || `HTTP ${response.status}`);
        }
        await refreshCurrentResources();
        return true;
      } catch (err) {
        setError(err.message || '删除目标点失败');
        return false;
      } finally {
        setMutating(false);
      }
    },
    [refreshCurrentResources]
  );

  const createRoute = useCallback(
    async (payload) => {
      setMutating(true);
      setError('');
      try {
        const response = await apiFetch('/api/v1/nav/routes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) {
          throw new Error(data.error || `HTTP ${response.status}`);
        }
        await refreshCurrentResources();
        return true;
      } catch (err) {
        setError(err.message || '新增线路失败');
        return false;
      } finally {
        setMutating(false);
      }
    },
    [refreshCurrentResources]
  );

  const deleteRoute = useCallback(
    async (routeId) => {
      setMutating(true);
      setError('');
      try {
        const response = await apiFetch(
          `/api/v1/nav/routes/${encodeURIComponent(routeId)}`,
          { method: 'DELETE' }
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) {
          throw new Error(data.error || `HTTP ${response.status}`);
        }
        await refreshCurrentResources();
        return true;
      } catch (err) {
        setError(err.message || '删除线路失败');
        return false;
      } finally {
        setMutating(false);
      }
    },
    [refreshCurrentResources]
  );

  const startRouteTask = useCallback(async (routeId) => {
    if (!routeId) return false;
    setMutating(true);
    setError('');
    try {
      const response = await apiFetch('/api/v1/nav/tasks/route/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ route_id: routeId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      return true;
    } catch (err) {
      setError(err.message || '启动导航任务失败');
      return false;
    } finally {
      setMutating(false);
    }
  }, []);

  const pauseRouteTask = useCallback(async () => {
    setMutating(true);
    setError('');
    try {
      const response = await apiFetch('/api/v1/nav/tasks/route/pause', {
        method: 'POST',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      return true;
    } catch (err) {
      setError(err.message || '暂停导航任务失败');
      return false;
    } finally {
      setMutating(false);
    }
  }, []);

  const resumeRouteTask = useCallback(async () => {
    setMutating(true);
    setError('');
    try {
      const response = await apiFetch('/api/v1/nav/tasks/route/resume', {
        method: 'POST',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      return true;
    } catch (err) {
      setError(err.message || '恢复导航任务失败');
      return false;
    } finally {
      setMutating(false);
    }
  }, []);

  const stopRouteTask = useCallback(async () => {
    setMutating(true);
    setError('');
    try {
      const response = await apiFetch('/api/v1/nav/tasks/route/stop', {
        method: 'POST',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      return true;
    } catch (err) {
      setError(err.message || '终止导航任务失败');
      return false;
    } finally {
      setMutating(false);
    }
  }, []);

  /** 快速导航：地图选点单点下发，不落盘目标点/线路 */
  const startPointTask = useCallback(async ({ x, y, yaw }) => {
    setMutating(true);
    setError('');
    try {
      const response = await apiFetch('/api/v1/nav/tasks/point/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x, y, yaw }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      return true;
    } catch (err) {
      setError(err.message || '快速导航下发失败');
      return false;
    } finally {
      setMutating(false);
    }
  }, []);

  const loadedMapName = useMemo(
    () => activeMap?.name || maps.find((map) => map.id === loadedMapId)?.name || '',
    [activeMap, maps, loadedMapId]
  );

  return {
    maps,
    loadedMapId,
    loadedMapName,
    activeMap,
    waypoints,
    routes,
    loadingMaps,
    loadingResources,
    mutating,
    error,
    refreshMaps,
    refreshCurrentResources,
    loadMap,
    deleteMap,
    createWaypoint,
    deleteWaypoint,
    createRoute,
    deleteRoute,
    startRouteTask,
    pauseRouteTask,
    resumeRouteTask,
    stopRouteTask,
    startPointTask,
  };
}
