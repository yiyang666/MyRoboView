import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../../../utils/apiClient';

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 5;
const ZOOM_STEP = 1.15;

const clampZoom = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

/** SLAM 实时路径配色：避开地图深蓝底/灰墙与航点(橙)、机器人(蓝)、持久化线路(青灰) */
const NAV_PATH_STYLE = {
  global: {
    color: '#c084fc',       // 紫色虚线：全局规划中间段
    outline: 'rgba(15, 23, 42, 0.72)',
    lineWidth: 2.5,
    dashed: true,
    dash: [10, 7],
    markEndpoint: true,     // 最后一个点画实心紫点
    pointRadius: 7,
  },
  local: {
    color: '#fb7185',       // 玫瑰红：局部「最近目标」；单点时与机器人连线
    outline: 'rgba(15, 23, 42, 0.72)',
    lineWidth: 3.5,
    dashed: false,
    pointRadius: 6,
  },
};

const DEFAULT_ORIGIN = { x: 0, y: 0 };

const getWorldBounds = (map) => {
  if (!map) return null;
  return {
    minX: map.originX ?? DEFAULT_ORIGIN.x,
    minY: map.originY ?? DEFAULT_ORIGIN.y,
    maxX: (map.originX ?? DEFAULT_ORIGIN.x) + (map.width || 0),
    maxY: (map.originY ?? DEFAULT_ORIGIN.y) + (map.height || 0),
  };
};

const waypointLookupOf = (waypoints = []) =>
  Object.fromEntries(waypoints.map((waypoint) => [waypoint.id, waypoint]));

/** 由当前视图把屏幕坐标换算为世界坐标 */
const screenToWorld = (sx, sy, cssW, cssH, map, view) => {
  const bounds = getWorldBounds(map);
  if (!bounds) return null;
  const pad = 28;
  const baseScale = Math.min(
    (cssW - pad * 2) / Math.max(map.width || 0, 1),
    (cssH - pad * 2) / Math.max(map.height || 0, 1)
  );
  const scale = baseScale * view.zoom;
  const centerWorldX = (bounds.minX + bounds.maxX) / 2;
  const centerWorldY = (bounds.minY + bounds.maxY) / 2;
  const ox = cssW / 2 + view.panX - centerWorldX * scale;
  const oy = cssH / 2 + view.panY + centerWorldY * scale;
  return {
    x: (sx - ox) / scale,
    y: (oy - sy) / scale,
  };
};

/**
 * 在 from -> to 线段末端画箭头，直观表达导航方向
 * tipInset：箭头尖端相对终点内缩，避免压住目标点圆点
 */
const drawDirectedSegment = (ctx, from, to, color, lineWidth) => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 2) return;

  const ux = dx / len;
  const uy = dy / len;
  const tipInset = Math.min(12, len * 0.28);
  const endX = to.x - ux * tipInset;
  const endY = to.y - uy * tipInset;

  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(endX, endY);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash([]);
  ctx.stroke();

  const arrowLen = Math.min(12, Math.max(8, lineWidth * 3));
  const arrowWidth = Math.min(7, Math.max(5, lineWidth * 1.8));
  const bx = -uy;
  const by = ux;
  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(endX - ux * arrowLen + bx * arrowWidth, endY - uy * arrowLen + by * arrowWidth);
  ctx.lineTo(endX - ux * arrowLen - bx * arrowWidth, endY - uy * arrowLen - by * arrowWidth);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
};

/** 绘制 SLAM 路径：多点折线；单点时用机器人位姿连到目标点（局部最近目标） */
const drawNavPathPolyline = (ctx, toScreen, pathData, style, robotPose) => {
  const points = pathData?.points;
  if (!Array.isArray(points) || points.length < 1) return;

  const {
    color,
    lineWidth,
    dashed = false,
    dash = [8, 6],
    outline,
    pointRadius = 6,
    markEndpoint = false,
  } = style;

  const strokeSegment = (from, to) => {
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.setLineDash(dashed ? dash : []);
    if (outline) {
      ctx.strokeStyle = outline;
      ctx.lineWidth = lineWidth + 2.2;
      ctx.stroke();
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    ctx.setLineDash([]);
  };

  const fillPoint = (screenPt) => {
    ctx.beginPath();
    ctx.arc(screenPt.x, screenPt.y, pointRadius, 0, Math.PI * 2);
    if (outline) {
      ctx.fillStyle = outline;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(screenPt.x, screenPt.y, Math.max(2, pointRadius - 1.5), 0, Math.PI * 2);
    }
    ctx.fillStyle = color;
    ctx.fill();
  };

  // SLAM 局部 Path 常为单点最近目标：从当前位置连线到该点
  if (points.length === 1) {
    const goal = toScreen(points[0].x, points[0].y);
    const hasPose =
      robotPose &&
      typeof robotPose.x === 'number' &&
      typeof robotPose.y === 'number' &&
      Number.isFinite(robotPose.x) &&
      Number.isFinite(robotPose.y);
    if (hasPose) {
      strokeSegment(toScreen(robotPose.x, robotPose.y), goal);
    }
    fillPoint(goal);
    return;
  }

  ctx.beginPath();
  const head = toScreen(points[0].x, points[0].y);
  ctx.moveTo(head.x, head.y);
  for (let i = 1; i < points.length; i += 1) {
    const p = toScreen(points[i].x, points[i].y);
    ctx.lineTo(p.x, p.y);
  }
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash(dashed ? dash : []);

  if (outline) {
    ctx.strokeStyle = outline;
    ctx.lineWidth = lineWidth + 2.2;
    ctx.stroke();
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.setLineDash([]);

  // 全局路径：末点用实心圆标出目标
  if (markEndpoint) {
    const last = points[points.length - 1];
    fillPoint(toScreen(last.x, last.y));
  }
};

/** 绘制选点草稿位姿（绿点 + 朝向箭头） */
const drawDraftPose = (ctx, toScreen, draft, scale) => {
  if (!draft || typeof draft.x !== 'number' || typeof draft.y !== 'number') return;
  const p = toScreen(draft.x, draft.y);
  const yaw = typeof draft.yaw === 'number' ? draft.yaw : 0;
  const r = Math.max(7, 0.28 * scale);
  const arrowLen = Math.max(18, 0.7 * scale);
  const sx = Math.cos(yaw);
  const sy = -Math.sin(yaw);

  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#22c55e';
  ctx.fill();
  ctx.strokeStyle = '#bbf7d0';
  ctx.lineWidth = 2;
  ctx.stroke();

  const tipX = p.x + sx * arrowLen;
  const tipY = p.y + sy * arrowLen;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(tipX, tipY);
  ctx.strokeStyle = '#4ade80';
  ctx.lineWidth = 3;
  ctx.stroke();

  const bx = -sy;
  const by = sx;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - sx * 10 + bx * 6, tipY - sy * 10 + by * 6);
  ctx.lineTo(tipX - sx * 10 - bx * 6, tipY - sy * 10 - by * 6);
  ctx.closePath();
  ctx.fillStyle = '#4ade80';
  ctx.fill();
};

/**
 * 2D 地图画布：
 * - 支持加载静态底图（SVG/PNG）
 * - 前端负责 world -> pixel/world -> screen 的换算
 * - 在底图上叠加线路、SLAM 规划路径、目标点、机器人位姿
 * - pickMode 下：点击定位、拖拽箭头选方向
 * 支持滚轮缩放、按钮缩放、拖拽平移
 */
const MapCanvas = ({
  map,
  poseRef,
  globalPathRef,
  localPathRef,
  waypoints = [],
  routes = [],
  highlightedRouteId = '',
  pickMode = null,
  draftPose = null,
  onDraftPoseChange,
  onPickConfirm,
  onPickCancel,
  emptyHint, // 无地图时的提示；建图 waiting 可覆盖默认文案
  initialZoom = 1, // 相对适配比例的默认缩放，手机导航可传 1.2
}) => {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const mapRef = useRef(map);
  const waypointsRef = useRef(waypoints);
  const routesRef = useRef(routes);
  const highlightedRouteRef = useRef(highlightedRouteId);
  const pickModeRef = useRef(pickMode);
  const draftPoseRef = useRef(draftPose);
  const onDraftPoseChangeRef = useRef(onDraftPoseChange);
  const imageRef = useRef(null);
  // 当前已展示帧对应的 blob URL（双缓冲时旧帧先留着，换图后再 revoke）
  const blobUrlRef = useRef('');
  const defaultZoom = clampZoom(Number(initialZoom) || 1);
  // 视图变换：zoom 相对适配比例；pan 为屏幕像素偏移
  const viewRef = useRef({ zoom: defaultZoom, panX: 0, panY: 0 });
  const dragRef = useRef({ active: false, lastX: 0, lastY: 0 });
  // 选点拖拽：按下落点，拖动改 yaw
  const pickDragRef = useRef({ active: false, ox: 0, oy: 0 });
  const [zoomLabel, setZoomLabel] = useState(Math.round(defaultZoom * 100));

  mapRef.current = map;
  waypointsRef.current = waypoints;
  routesRef.current = routes;
  highlightedRouteRef.current = highlightedRouteId;
  pickModeRef.current = pickMode;
  draftPoseRef.current = draftPose;
  onDraftPoseChangeRef.current = onDraftPoseChange;

  // 切换地图时复位到默认缩放
  useEffect(() => {
    const z = clampZoom(Number(initialZoom) || 1);
    viewRef.current = { zoom: z, panX: 0, panY: 0 };
    setZoomLabel(Math.round(z * 100));
  }, [map?.id, initialZoom]);

  // 卸载时回收仍挂着的 blob URL
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = '';
      }
    };
  }, []);

  // 底图加载：新图 ready 前保留旧帧，避免建图 revision 更新时 2Hz 闪烁
  useEffect(() => {
    if (!map?.imageUrl) {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = '';
      }
      imageRef.current = null;
      return undefined;
    }

    let pendingObjectUrl = '';
    let cancelled = false;
    const img = new Image();
    img.decoding = 'async';

    const applyImage = (src) => {
      img.onload = () => {
        if (cancelled) return;
        const prevUrl = blobUrlRef.current;
        // 新图就绪后再换，中间不空帧
        imageRef.current = img;
        if (typeof src === 'string' && src.startsWith('blob:')) {
          blobUrlRef.current = src;
        }
        if (prevUrl && prevUrl !== src) {
          URL.revokeObjectURL(prevUrl);
        }
      };
      img.onerror = () => {
        // 失败保留旧帧，不把画面清空
        if (!cancelled) {
          console.warn('[MapCanvas] load map image failed');
        }
      };
      img.src = src;
    };

    if (map.imageUrl.startsWith('/api/')) {
      apiFetch(map.imageUrl)
        .then(async (resp) => {
          if (!resp.ok) throw new Error(`image http ${resp.status}`);
          const blob = await resp.blob();
          if (cancelled) return;
          pendingObjectUrl = URL.createObjectURL(blob);
          applyImage(pendingObjectUrl);
        })
        .catch((err) => {
          console.warn('[MapCanvas] load map image failed:', err);
        });
    } else {
      applyImage(map.imageUrl);
    }

    return () => {
      cancelled = true;
      // 仅回收尚未挂上的 pending；已展示帧留给下次成功替换或卸载时回收
      if (pendingObjectUrl && pendingObjectUrl !== blobUrlRef.current) {
        URL.revokeObjectURL(pendingObjectUrl);
      }
    };
  }, [map?.imageUrl]);

  const applyZoomAt = useCallback((nextZoom, screenX, screenY) => {
    const view = viewRef.current;
    const z0 = view.zoom;
    const z1 = clampZoom(nextZoom);
    if (z1 === z0) return;

    // 以光标为锚点缩放：保持该点世界坐标不变
    const wrap = wrapRef.current;
    if (wrap && Number.isFinite(screenX) && Number.isFinite(screenY)) {
      const ox = wrap.clientWidth / 2 + view.panX;
      const oy = wrap.clientHeight / 2 + view.panY;
      const dx = screenX - ox;
      const dy = screenY - oy;
      const k = z1 / z0;
      view.panX += dx - dx * k;
      view.panY += dy - dy * k;
    }

    view.zoom = z1;
    setZoomLabel(Math.round(z1 * 100));
  }, []);

  const zoomBy = useCallback(
    (factor) => {
      const wrap = wrapRef.current;
      const cx = wrap ? wrap.clientWidth / 2 : 0;
      const cy = wrap ? wrap.clientHeight / 2 : 0;
      applyZoomAt(viewRef.current.zoom * factor, cx, cy);
    },
    [applyZoomAt]
  );

  const resetView = useCallback(() => {
    const z = clampZoom(Number(initialZoom) || 1);
    viewRef.current = { zoom: z, panX: 0, panY: 0 };
    setZoomLabel(Math.round(z * 100));
  }, [initialZoom]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return undefined;

    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    let raf = 0;
    let running = true;

    const drawFrame = () => {
      if (!running) return;

      const currentMap = mapRef.current;
      const currentWaypoints = waypointsRef.current;
      const currentRoutes = routesRef.current;
      const currentHighlightedRouteId = highlightedRouteRef.current;
      const currentDraft = draftPoseRef.current;
      const currentImage = imageRef.current;
      const dpr = window.devicePixelRatio || 1;
      const cssW = wrap.clientWidth;
      const cssH = wrap.clientHeight;

      canvas.width = Math.floor(Math.max(cssW, 1) * dpr);
      canvas.height = Math.floor(Math.max(cssH, 1) * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.fillStyle = '#151528';
      ctx.fillRect(0, 0, cssW, cssH);

      if (!currentMap || cssW <= 0 || cssH <= 0) {
        raf = requestAnimationFrame(drawFrame);
        return;
      }

      const bounds = getWorldBounds(currentMap);
      if (!bounds) {
        raf = requestAnimationFrame(drawFrame);
        return;
      }

      const pad = 28;
      const baseScale = Math.min(
        (cssW - pad * 2) / Math.max(currentMap.width || 0, 1),
        (cssH - pad * 2) / Math.max(currentMap.height || 0, 1)
      );
      const { zoom, panX, panY } = viewRef.current;
      const scale = baseScale * zoom;
      const centerWorldX = (bounds.minX + bounds.maxX) / 2;
      const centerWorldY = (bounds.minY + bounds.maxY) / 2;
      const ox = cssW / 2 + panX - centerWorldX * scale;
      const oy = cssH / 2 + panY + centerWorldY * scale;

      const toScreen = (wx, wy) => ({
        x: ox + wx * scale,
        y: oy - wy * scale,
      });

      const worldToPixel = (wx, wy) => {
        const resolution = currentMap.resolution || 0.05;
        const pixelX = (wx - bounds.minX) / resolution;
        const pixelY = (bounds.maxY - wy) / resolution;
        return { x: pixelX, y: pixelY };
      };

      // 网格（1m）
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
      ctx.lineWidth = 1;
      for (let x = Math.floor(bounds.minX); x <= Math.ceil(bounds.maxX); x += 1) {
        const a = toScreen(x, bounds.minY);
        const b = toScreen(x, bounds.maxY);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      for (let y = Math.floor(bounds.minY); y <= Math.ceil(bounds.maxY); y += 1) {
        const a = toScreen(bounds.minX, y);
        const b = toScreen(bounds.maxX, y);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      // 地图边界 / 底图：底图负责展示墙体轮廓和障碍物
      const tl = toScreen(bounds.minX, bounds.maxY);
      const wallPx = Math.max(2, (currentMap.wallThickness || 0.2) * scale);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.22)';
      ctx.fillRect(tl.x, tl.y, currentMap.width * scale, currentMap.height * scale);
      if (currentImage) {
        ctx.drawImage(currentImage, tl.x, tl.y, currentMap.width * scale, currentMap.height * scale);
      }
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = wallPx;
      ctx.strokeRect(tl.x, tl.y, currentMap.width * scale, currentMap.height * scale);

      // 原点十字
      ctx.strokeStyle = 'rgba(96, 165, 250, 0.35)';
      ctx.lineWidth = 1;
      const o = toScreen(bounds.minX, bounds.minY);
      ctx.beginPath();
      ctx.moveTo(o.x - 10, o.y);
      ctx.lineTo(o.x + 10, o.y);
      ctx.moveTo(o.x, o.y - 10);
      ctx.lineTo(o.x, o.y + 10);
      ctx.stroke();

      // 先画路线：点与点之间用末端箭头连接，并标注线路名称
      const waypointLookup = waypointLookupOf(currentWaypoints);
      currentRoutes.forEach((route) => {
        const routePoints = (route.waypoint_ids || [])
          .map((waypointId) => waypointLookup[waypointId])
          .filter(Boolean);
        if (routePoints.length < 2) return;

        const isHighlighted = route.id === currentHighlightedRouteId;
        const color = isHighlighted ? '#38bdf8' : 'rgba(148, 163, 184, 0.85)';
        const lineWidth = isHighlighted ? 3.5 : 2;

        for (let i = 0; i < routePoints.length - 1; i += 1) {
          const a = toScreen(routePoints[i].x, routePoints[i].y);
          const b = toScreen(routePoints[i + 1].x, routePoints[i + 1].y);
          drawDirectedSegment(ctx, a, b, color, lineWidth);
        }

        // 线路名称放在首段中点附近，便于区分多条路线
        const midA = toScreen(routePoints[0].x, routePoints[0].y);
        const midB = toScreen(routePoints[1].x, routePoints[1].y);
        const labelX = (midA.x + midB.x) / 2;
        const labelY = (midA.y + midB.y) / 2 - 8;
        ctx.font = isHighlighted ? 'bold 13px sans-serif' : '12px sans-serif';
        ctx.fillStyle = isHighlighted ? '#ef4444' : '#f87171'; // 红色系：高亮为红色，非高亮为浅红色
   
        ctx.fillText(route.name || route.id, labelX, labelY);
      });

      // SLAM 全局规划（紫虚线）与局部最近目标（玫瑰红：单点则连当前位置）
      const currentPose = poseRef?.current;
      drawNavPathPolyline(ctx, toScreen, globalPathRef?.current, NAV_PATH_STYLE.global);
      drawNavPathPolyline(
        ctx,
        toScreen,
        localPathRef?.current,
        NAV_PATH_STYLE.local,
        currentPose
      );

      // 目标点叠加层：圆点 + 名称
      currentWaypoints.forEach((waypoint) => {
        const p = toScreen(waypoint.x, waypoint.y);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
        ctx.fillStyle = '#f59e0b';
        ctx.fill();
        ctx.strokeStyle = '#fff7ed';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = '#339'; // 使用深蓝色，兼顾白底和黑底均清晰
   
        ctx.font = 'bold 13px sans-serif';
        ctx.fillText(waypoint.name || waypoint.id, p.x + 10, p.y - 10);
      });

      // 机器人：圆点 + 朝向箭头
      if (
        currentPose &&
        typeof currentPose.x === 'number' &&
        typeof currentPose.y === 'number'
      ) {
        const p = toScreen(currentPose.x, currentPose.y);
        const yaw = typeof currentPose.yaw === 'number' ? currentPose.yaw : 0;
        const r = Math.max(6, 0.25 * scale);
        const arrowLen = Math.max(12, 0.55 * scale);

        const sx = Math.cos(yaw);
        const sy = -Math.sin(yaw);

        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = '#3b82f6';
        ctx.fill();
        ctx.strokeStyle = '#93c5fd';
        ctx.lineWidth = 2;
        ctx.stroke();

        const tipX = p.x + sx * arrowLen;
        const tipY = p.y + sy * arrowLen;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(tipX, tipY);
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 3;
        ctx.stroke();

        const bx = -sy;
        const by = sx;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - sx * 8 + bx * 5, tipY - sy * 8 + by * 5);
        ctx.lineTo(tipX - sx * 8 - bx * 5, tipY - sy * 8 - by * 5);
        ctx.closePath();
        ctx.fillStyle = '#fbbf24';
        ctx.fill();
      }

      // 选点草稿位姿
      drawDraftPose(ctx, toScreen, currentDraft, scale);

      // world -> pixel 调试信息：便于后续接真实栅格地图参数
      if (currentPose && typeof currentPose.x === 'number' && typeof currentPose.y === 'number') {
        const pixelPose = worldToPixel(currentPose.x, currentPose.y);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '12px sans-serif';
        ctx.fillText(
          `world(${currentPose.x.toFixed(2)}, ${currentPose.y.toFixed(2)}) -> px(${pixelPose.x.toFixed(0)}, ${pixelPose.y.toFixed(0)})`,
          12,
          38
        );
      }

      ctx.fillStyle = '#64748b';
      ctx.font = '12px sans-serif';
      ctx.fillText(
        `${currentMap.name}  ${currentMap.width}m × ${currentMap.height}m  res ${currentMap.resolution}m/px`,
        12,
        20
      );

      raf = requestAnimationFrame(drawFrame);
    };

    raf = requestAnimationFrame(drawFrame);

    // 滚轮缩放（以光标为中心）
    const onWheel = (e) => {
      e.preventDefault();
      const rect = wrap.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      applyZoomAt(viewRef.current.zoom * factor, sx, sy);
    };

    const onPointerDown = (e) => {
      if (e.button !== 0) return;
      // 缩放 / 选点工具条不触发画布交互
      if (e.target.closest?.('.map-nav-zoom-controls')) return;
      if (e.target.closest?.('.map-nav-pick-bar')) return;

      const mode = pickModeRef.current;
      if (mode) {
        const currentMap = mapRef.current;
        if (!currentMap) return;
        const rect = wrap.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const world = screenToWorld(sx, sy, wrap.clientWidth, wrap.clientHeight, currentMap, viewRef.current);
        if (!world) return;
        const prevYaw =
          typeof draftPoseRef.current?.yaw === 'number' ? draftPoseRef.current.yaw : 0;
        const next = { x: world.x, y: world.y, yaw: prevYaw };
        pickDragRef.current = { active: true, ox: world.x, oy: world.y };
        onDraftPoseChangeRef.current?.(next);
        wrap.setPointerCapture?.(e.pointerId);
        wrap.classList.add('is-picking');
        return;
      }

      dragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY };
      wrap.setPointerCapture?.(e.pointerId);
      wrap.classList.add('is-panning');
    };
    const onPointerMove = (e) => {
      if (pickDragRef.current.active && pickModeRef.current) {
        const currentMap = mapRef.current;
        if (!currentMap) return;
        const rect = wrap.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const world = screenToWorld(sx, sy, wrap.clientWidth, wrap.clientHeight, currentMap, viewRef.current);
        if (!world) return;
        const { ox, oy } = pickDragRef.current;
        const dx = world.x - ox;
        const dy = world.y - oy;
        // 拖拽距离太短时保持原 yaw，避免抖动
        if (Math.hypot(dx, dy) < 0.05) return;
        const yaw = Math.atan2(dy, dx);
        onDraftPoseChangeRef.current?.({ x: ox, y: oy, yaw });
        return;
      }

      if (!dragRef.current.active) return;
      const dx = e.clientX - dragRef.current.lastX;
      const dy = e.clientY - dragRef.current.lastY;
      dragRef.current.lastX = e.clientX;
      dragRef.current.lastY = e.clientY;
      viewRef.current.panX += dx;
      viewRef.current.panY += dy;
    };
    const onPointerUp = (e) => {
      if (pickDragRef.current.active) {
        pickDragRef.current.active = false;
        wrap.releasePointerCapture?.(e.pointerId);
        wrap.classList.remove('is-picking');
        return;
      }
      dragRef.current.active = false;
      wrap.releasePointerCapture?.(e.pointerId);
      wrap.classList.remove('is-panning');
    };

    wrap.addEventListener('wheel', onWheel, { passive: false });
    wrap.addEventListener('pointerdown', onPointerDown);
    wrap.addEventListener('pointermove', onPointerMove);
    wrap.addEventListener('pointerup', onPointerUp);
    wrap.addEventListener('pointercancel', onPointerUp);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      wrap.removeEventListener('wheel', onWheel);
      wrap.removeEventListener('pointerdown', onPointerDown);
      wrap.removeEventListener('pointermove', onPointerMove);
      wrap.removeEventListener('pointerup', onPointerUp);
      wrap.removeEventListener('pointercancel', onPointerUp);
    };
  }, [poseRef, applyZoomAt]);

  const pickHint =
    pickMode === 'manual_reloc'
      ? '手动重定位：在地图上点击落点，拖拽箭头选择方向'
      : pickMode === 'waypoint'
        ? '新增目标点：在地图上点击落点，拖拽箭头选择方向'
        : pickMode === 'quick_nav'
          ? '快速导航：在地图上点击落点，拖拽箭头选择方向'
          : '';

  return (
    <div className={`map-nav-canvas-wrap ${pickMode ? 'is-pick-mode' : ''}`} ref={wrapRef}>
      <canvas className="map-nav-canvas" ref={canvasRef} />
      {!map ? (
        <div className="map-nav-empty-hint">
          {emptyHint || '请先在地图管理中加载一张地图'}
        </div>
      ) : (
        <>
          <div className="map-nav-zoom-controls" aria-label="地图缩放">
            <button
              type="button"
              className="map-nav-zoom-btn"
              title="缩小"
              onClick={() => zoomBy(1 / ZOOM_STEP)}
            >
              −
            </button>
            <div className="map-nav-zoom-label">{zoomLabel}%</div>
            <button
              type="button"
              className="map-nav-zoom-btn"
              title="放大"
              onClick={() => zoomBy(ZOOM_STEP)}
            >
              +
            </button>
            <button
              type="button"
              className="map-nav-zoom-btn map-nav-zoom-reset"
              title="复位"
              onClick={resetView}
            >
              ⊙
            </button>
          </div>
          {pickMode ? (
            <div className="map-nav-pick-bar">
              <span className="map-nav-pick-hint">{pickHint}</span>
              {draftPose ? (
                <span className="map-nav-pick-pose">
                  x={draftPose.x.toFixed(2)} y={draftPose.y.toFixed(2)} yaw=
                  {draftPose.yaw.toFixed(2)}
                </span>
              ) : null}
              <div className="map-nav-pick-actions">
                {pickMode === 'manual_reloc' ? (
                  <button
                    type="button"
                    className="map-nav-btn primary"
                    disabled={!draftPose}
                    onClick={() => onPickConfirm?.(draftPose)}
                  >
                    确认下发
                  </button>
                ) : null}
                {pickMode === 'quick_nav' ? (
                  <button
                    type="button"
                    className="map-nav-btn primary"
                    disabled={!draftPose}
                    onClick={() => onPickConfirm?.(draftPose)}
                  >
                    开始导航
                  </button>
                ) : null}
                <button type="button" className="map-nav-btn muted" onClick={() => onPickCancel?.()}>
                  取消
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
};

export default MapCanvas;
