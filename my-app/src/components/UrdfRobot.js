/*
 * URDF Web 展示（visual mesh + joint）：
 *   1. 默认：保留 GLB 原色 + 不透明渲染；健康圆环 HUD（depthTest=false）可透出外壳
 *   2. 开「关节轴」：外壳切幽灵半透明（ghostOpacity），便于看红轴/绿弧
 *   3. 健康圆环仅挂在配置中的电机关节上（fixed 传感器关节不显示）
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import URDFLoader from 'urdf-loader';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const DEFAULT_ROTATION_X = -Math.PI / 2; // URDF Z-up → Three.js Y-up

// ========== 外壳外观 ==========
// overwriteColor=false：保留原始材质色（当前默认，一般无需再调色）
// ghostOpacity：仅「关节轴」开启时生效
const VISUAL_SHELL = {
  overwriteColor: false,
  color: '#8496a8', // 仅 overwriteColor=true 时使用
  ghostOpacity: 0.38,
  metalness: 0.05,
  roughness: 0.72,
};

const _shellColor = new THREE.Color(VISUAL_SHELL.color);

// ========== 关节健康圆环（HUD） ==========
const JOINT_MARKER = {
  ringRadius: 0.022,
  tubeRadius: 0.0035,
  emissive: 0.85,
  opacity: 0.65,
};

const MARKER_NAME = '__joint_status_marker__';
const AXIS_HELPER_NAME = '__joint_axis_helper__';
const _torusNormal = new THREE.Vector3(0, 0, 1); // TorusGeometry 默认法线沿 Z
const _upY = new THREE.Vector3(0, 1, 0);
const _axisZ = new THREE.Vector3(0, 0, 1);

// 关节轴箭头尺寸：对齐 robot_viewer 固定 0.2m，避免过小难辨认
const JOINT_AXIS_VIS = {
  arrowLength: 0.2,
  shaftRadius: 0.004,
  headRadius: 0.012,
  arcTubeRadius: 0.002,
  arcArrowSize: 0.008,
};

/** 是否为关节装饰节点（状态圆环 / 关节轴），外壳与包围盒需跳过 */
const isJointDecorMesh = (obj) => {
  let p = obj;
  while (p) {
    if (p.name === MARKER_NAME || p.name === AXIS_HELPER_NAME) return true;
    p = p.parent;
  }
  return false;
};

/** 只查直接子节点（勿用 getObjectByName，否则会命中子孙关节上的同名辅助体） */
const getDirectChildByName = (parent, name) => {
  if (!parent?.children) return null;
  for (let i = 0; i < parent.children.length; i += 1) {
    if (parent.children[i].name === name) return parent.children[i];
  }
  return null;
};

/** 可旋转关节：revolute / continuous（与 robot_viewer、URDFDragControls 一致） */
const isRotatableJoint = (jointObj) => {
  if (!jointObj?.isURDFJoint) return false;
  const jt = jointObj.jointType;
  return jt === 'revolute' || jt === 'continuous';
};

// 将圆环法线对齐到 URDF joint 的旋转轴，使圆环落在关节旋转面上
const alignMarkerToJointAxis = (marker, jointObj) => {
  if (!jointObj?.axis) return;

  const axis = jointObj.axis;
  if (axis.lengthSq() < 1e-8) return;

  const normalized = axis.clone().normalize();
  marker.quaternion.setFromUnitVectors(_torusNormal, normalized);
};

/**
 * 计算机器人 visual 的世界包围盒。
 * 对齐 urdf-loader 官方 viewer / robot_viewer：优先 expandByObject(URDFVisual)。
 */
const getRobotVisualWorldBox = (root) => {
  root.updateMatrixWorld(true);

  const box = new THREE.Box3();
  let hasVisual = false;

  root.traverse((obj) => {
    // urdf-loader 为每个 <visual> 创建的节点带 isURDFVisual
    if (obj.isURDFVisual) {
      box.expandByObject(obj);
      hasVisual = true;
    }
  });

  // 兜底：若没有 URDFVisual 标记，退回对 mesh 求盒
  if (!hasVisual || box.isEmpty()) {
    box.makeEmpty();
    root.traverse((obj) => {
      if (!obj.isMesh || isJointDecorMesh(obj) || !obj.geometry) return;
      if (!obj.geometry.boundingBox) {
        obj.geometry.computeBoundingBox();
      }
      box.expandByObject(obj);
    });
  }

  return box;
};

/**
 * 创建绕关节轴的绿色旋转方向指示（右手定则正转），对齐 robot_viewer。
 * @param {THREE.Vector3} axisDirection 已归一化的关节轴
 * @param {number} baseLength 红箭头总长，用于定弧半径与位置
 */
const createRotationIndicator = (axisDirection, baseLength) => {
  const group = new THREE.Group();
  const radius = baseLength * 0.25;
  const tubeRadius = JOINT_AXIS_VIS.arcTubeRadius;
  const arrowSize = JOINT_AXIS_VIS.arcArrowSize;
  const color = 0x00ff00;

  // 270° 圆弧：右手握轴，拇指朝轴正方向，四指弯曲为正转
  const arcAngle = Math.PI * 1.5;
  const curve = new THREE.EllipseCurve(0, 0, radius, radius, 0, arcAngle, false, 0);
  const points3D = curve.getPoints(50).map((p) => new THREE.Vector3(p.x, p.y, 0));
  const curvePath = new THREE.CatmullRomCurve3(points3D);
  const tubeMesh = new THREE.Mesh(
    new THREE.TubeGeometry(curvePath, 50, tubeRadius, 8, false),
    new THREE.MeshBasicMaterial({ color, depthTest: false }),
  );
  tubeMesh.renderOrder = 998;
  group.add(tubeMesh);

  const coneMesh = new THREE.Mesh(
    new THREE.ConeGeometry(arrowSize, arrowSize * 2, 8),
    new THREE.MeshBasicMaterial({ color, depthTest: false }),
  );
  coneMesh.renderOrder = 998;
  const endPoint = points3D[points3D.length - 1];
  const preEndPoint = points3D[Math.max(0, points3D.length - 5)];
  const tangent = new THREE.Vector3().subVectors(endPoint, preEndPoint).normalize();
  coneMesh.position.copy(endPoint);
  coneMesh.quaternion.setFromUnitVectors(_upY, tangent);
  group.add(coneMesh);

  // 弧面垂直于轴，并靠近箭头尖端
  group.quaternion.setFromUnitVectors(_axisZ, axisDirection);
  group.position.copy(axisDirection.clone().multiplyScalar(baseLength * 0.85));
  return group;
};

/**
 * 创建关节轴辅助：红箭头（轴正方向）+ 绿弧（正转方向）。
 * 尺寸对齐 robot_viewer CoordinateAxesManager（箭头总长 0.2m）。
 * @param {THREE.Vector3} axisDirection 关节局部轴
 */
const createJointAxisHelper = (axisDirection) => {
  const normalized = axisDirection.clone().normalize();
  const arrowLength = JOINT_AXIS_VIS.arrowLength;
  const shaftLength = arrowLength * 0.7;
  const headLength = arrowLength * 0.3;
  const { shaftRadius, headRadius } = JOINT_AXIS_VIS;
  const material = new THREE.MeshBasicMaterial({
    color: 0xff0000,
    depthTest: false,
  });

  const shaftMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLength, 16, 1),
    material,
  );
  shaftMesh.position.y = shaftLength / 2;
  shaftMesh.renderOrder = 998;

  const headMesh = new THREE.Mesh(
    new THREE.ConeGeometry(headRadius, headLength, 32, 1),
    material.clone(),
  );
  headMesh.position.y = shaftLength + headLength / 2;
  headMesh.renderOrder = 998;

  // 本地先沿 +Y 建箭头，再旋到 joint.axis
  const arrow = new THREE.Group();
  arrow.add(shaftMesh);
  arrow.add(headMesh);
  arrow.quaternion.setFromUnitVectors(_upY, normalized);

  const axisGroup = new THREE.Group();
  axisGroup.name = AXIS_HELPER_NAME;
  axisGroup.add(arrow);
  axisGroup.add(createRotationIndicator(normalized, arrowLength));
  axisGroup.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = false;
      child.receiveShadow = false;
    }
  });
  return axisGroup;
};

/**
 * 将模型最低点贴到地面 y=0（世界原点在地面）。
 * @returns {THREE.Box3|null} 对齐后的包围盒；mesh 未就绪时返回 null
 */
const alignRobotFootToGround = (root) => {
  const box = getRobotVisualWorldBox(root);
  if (box.isEmpty() || !Number.isFinite(box.min.y)) {
    return null;
  }

  // 脚在地下时 min.y < 0，整体上移 -min.y
  root.position.y -= box.min.y;
  root.updateMatrixWorld(true);
  return getRobotVisualWorldBox(root);
};

// 关节状态颜色（仅用于关节处圆环标记，不再给 link mesh 染色）
// offline 用亮紫，避免与半透明灰蓝外壳撞色导致圆环发糊
const STATUS_COLORS = {
  ok: '#34d399',
  warning: '#fbbf24',
  offline: '#a78bfa',
};

const UrdfRobot = ({
  urdfPath,
  packages,
  jointAngles = {},          // 形如 { 0: 0.1, 1: -0.5, ... } 关节角（弧度）
  jointVisualStatus = {},    // 形如 { 0: 'ok'|'offline'|'warning', ... }
  joints = [],               // 形如 [{ id, name, urdfName }, ...]
  rotationX = DEFAULT_ROTATION_X, // 模型旋转角度（URDF Z-up → Three.js Y-up）
  showJointHealth = true,    // 健康状态圆环，默认开启
  showJointAxes = false,     // 关节轴（红轴+绿弧）；开启时外壳切幽灵半透明
  enableShadows = true,      // 外壳是否投射/接收阴影
  robotRef,                  // 可选：将加载好的 robot 挂到外部 ref
  onLoaded,                  // 可选：贴地完成后回调 (urdfRobot, alignedBox) => {}
}) => {
  const [robot, setRobot] = useState(null);
  // urdf-loader 的 load() 在 parse 后立刻回调，mesh 异步后到；须等 LoadingManager.onLoad
  const [meshesReady, setMeshesReady] = useState(false);
  // 每个 robot 实例只自动贴地一次，避免关节动画后反复抬升
  const groundedRef = useRef(false);

  const statusColors = useMemo(() => {
    const colors = {};
    Object.entries(STATUS_COLORS).forEach(([key, hex]) => {
      colors[key] = new THREE.Color(hex);
    });
    return colors;
  }, []);

  // 在 joint 原点创建/获取状态圆环；圆环平面垂直于 joint.axis（与旋转面一致）
  const ensureJointMarker = (jointObj) => {
    // 仅查直接子节点，避免命中子孙关节上的同名圆环
    let marker = getDirectChildByName(jointObj, MARKER_NAME);
    if (marker) {
      alignMarkerToJointAxis(marker, jointObj);
      return marker;
    }

    const geometry = new THREE.TorusGeometry(
      JOINT_MARKER.ringRadius,
      JOINT_MARKER.tubeRadius,
      10,
      28,
    );
    // HUD：永远不写深度测试，实心外壳也不会挡住健康圆环
    const material = new THREE.MeshStandardMaterial({
      color: STATUS_COLORS.offline,
      emissive: STATUS_COLORS.offline,
      emissiveIntensity: JOINT_MARKER.emissive,
      transparent: true,
      opacity: JOINT_MARKER.opacity,
      depthWrite: false,
      depthTest: false,
    });
    marker = new THREE.Mesh(geometry, material);
    marker.name = MARKER_NAME;
    marker.renderOrder = 999;
    alignMarkerToJointAxis(marker, jointObj);
    jointObj.add(marker);
    return marker;
  };

  /**
   * 按模式刷新外壳材质与阴影。
   * - 默认：原色不透明（transparent=false, depthWrite=true）
   * - ghostMode（关节轴开）：半透明 + depthWrite=false
   */
  const applyVisualShellAppearance = (root, { ghostMode, shadowsEnabled }) => {
    root.traverse((obj) => {
      if (!obj.isMesh || isJointDecorMesh(obj)) return;

      const patchMaterial = (mat) => {
        if (!mat) return mat;
        // 首次克隆，避免改到 GLTF 共享材质；之后原地更新
        let next = mat;
        if (!mat.userData?.__visualShellOwned) {
          next = mat.clone();
          next.userData = { ...next.userData, __visualShellOwned: true };
        }
        if (VISUAL_SHELL.overwriteColor) {
          next.color.copy(_shellColor);
          if (next.emissive) next.emissive.set('#000000');
          if ('metalness' in next) next.metalness = VISUAL_SHELL.metalness;
          if ('roughness' in next) next.roughness = VISUAL_SHELL.roughness;
          if ('map' in next && next.map) next.map = null;
        }
        if (ghostMode) {
          next.transparent = true;
          next.opacity = VISUAL_SHELL.ghostOpacity;
          next.depthWrite = false;
        } else {
          next.transparent = false;
          next.opacity = 1;
          next.depthWrite = true;
        }
        next.needsUpdate = true;
        return next;
      };

      if (Array.isArray(obj.material)) {
        obj.material = obj.material.map(patchMaterial);
      } else {
        obj.material = patchMaterial(obj.material);
      }

      // 幽灵模式不投阴影；实心时跟随阴影开关
      const useShadow = shadowsEnabled && !ghostMode;
      obj.castShadow = useShadow;
      obj.receiveShadow = useShadow;
    });
  };

  const updateJointMarker = (marker, status, { visible }) => {
    if (!marker) return;

    // 无后端状态时仍显示圆环，默认 offline（紫）
    const resolved =
      status && statusColors[status] ? status : 'offline';
    const color = statusColors[resolved];

    marker.visible = visible;
    marker.material.color.copy(color);
    marker.material.emissive.copy(color);
    marker.material.emissiveIntensity = JOINT_MARKER.emissive;
    // 始终 HUD：不被外壳遮挡（实心 / 幽灵都一致）
    marker.material.depthTest = false;
    marker.material.depthWrite = false;
    marker.material.needsUpdate = true;
  };

  /**
   * 在 revolute/continuous 关节上挂红轴+绿弧；已存在则复用。
   * @returns {THREE.Group|null}
   */
  const ensureJointAxisHelper = (jointObj) => {
    if (!isRotatableJoint(jointObj)) {
      return null;
    }

    // 仅查直接子节点：getObjectByName 会命中子孙关节辅助体，导致 hip/thigh 不再建轴
    let helper = getDirectChildByName(jointObj, AXIS_HELPER_NAME);
    if (helper) return helper;

    const axis =
      jointObj.axis && jointObj.axis.lengthSq() > 1e-8
        ? jointObj.axis.clone().normalize()
        : new THREE.Vector3(0, 0, 1);

    helper = createJointAxisHelper(axis);
    jointObj.add(helper);
    return helper;
  };

  // 由配置建立 urdfName -> 状态 映射，用于给 URDF 里的 joint 上色
  const statusByUrdfName = useMemo(() => {
    const map = {};
    joints.forEach(({ id, urdfName }) => {
      if (!urdfName) return;
      map[urdfName] = jointVisualStatus[id];
    });
    return map;
  }, [joints, jointVisualStatus]);

  // 加载 URDF 模型
  // 注意：urdf-loader.load() 在 parse 后立刻 onComplete，mesh 经 loadMeshCb 异步挂入。
  // 必须等 LoadingManager.onLoad（全部 mesh 完成）后再贴地，否则包围盒为空/贴原点。
  useEffect(() => {
    let cancelled = false;
    setMeshesReady(false);
    groundedRef.current = false;

    const manager = new THREE.LoadingManager();
    manager.onLoad = () => {
      if (!cancelled) {
        setMeshesReady(true);
      }
    };

    const loader = new URDFLoader(manager);

    if (packages) {
      loader.packages = packages;
    }

    // 自定义 mesh 加载：支持 glb/gltf（Web 端轻量格式），并兼容旧的 stl。
    // urdf-loader 默认只处理 stl/dae，这里扩展 glb 支持。
    loader.loadMeshCb = (path, meshManager, onComplete) => {
      const cleanPath = path.split(/[?#]/)[0]; // 去掉查询串，取纯路径判断扩展名
      const ext = cleanPath.slice(cleanPath.lastIndexOf('.') + 1).toLowerCase();

      if (ext === 'glb' || ext === 'gltf') {
        const gltfLoader = new GLTFLoader(meshManager);
        gltfLoader.load(
          path,
          (gltf) => onComplete(gltf.scene), // glb 自带材质，作为 Group 返回
          undefined,
          (err) => onComplete(null, err),
        );
      } else if (ext === 'stl') {
        const stlLoader = new STLLoader(meshManager);
        stlLoader.load(
          path,
          (geometry) =>
            onComplete(new THREE.Mesh(geometry, new THREE.MeshPhongMaterial())),
          undefined,
          (err) => onComplete(null, err),
        );
      } else {
        onComplete(null, new Error(`不支持的 mesh 格式: ${ext}`));
      }
    };

    loader.load(urdfPath, (urdfRobot) => {
      if (cancelled) return;

      // 统一朝向：URDF 默认 Z-up，这里转成 three.js 常用的 Y-up
      if (rotationX !== 0) {
        urdfRobot.rotation.x = rotationX;
      }

      // 初次按当前开关应用外壳（默认不透明）；mesh 齐后再补一次
      applyVisualShellAppearance(urdfRobot, {
        ghostMode: false,
        shadowsEnabled: true,
      });

      setRobot(urdfRobot);
      if (robotRef) {
        robotRef.current = urdfRobot;
      }
    });

    return () => {
      cancelled = true;
    };
  }, [urdfPath, packages, rotationX, robotRef]);

  // mesh 全部就绪且已挂入场景后，再按脚底贴地（与 robot_viewer 延迟 updateEnvironment 同理）
  useLayoutEffect(() => {
    if (!robot || !meshesReady || groundedRef.current) return;

    applyVisualShellAppearance(robot, {
      ghostMode: showJointAxes,
      shadowsEnabled: enableShadows,
    });

    // 先套当前关节角，再按站姿算脚底
    joints.forEach(({ id, urdfName }) => {
      if (!urdfName) return;
      const angleRad = jointAngles[id] != null ? jointAngles[id] : 0;
      if (typeof robot.setJointValue === 'function') {
        robot.setJointValue(urdfName, angleRad);
      } else if (robot.joints?.[urdfName]?.setJointValue) {
        robot.joints[urdfName].setJointValue(angleRad);
      }
    });

    const alignedBox = alignRobotFootToGround(robot);
    if (!alignedBox) {
      // 极端情况：onLoad 已触发但 visual 尚未 expand 成功，再等一帧
      const raf = requestAnimationFrame(() => {
        if (groundedRef.current || !robot) return;
        applyVisualShellAppearance(robot, {
          ghostMode: showJointAxes,
          shadowsEnabled: enableShadows,
        });
        const retryBox = alignRobotFootToGround(robot);
        if (!retryBox) return;
        groundedRef.current = true;
        if (typeof onLoaded === 'function') {
          onLoaded(robot, retryBox);
        }
      });
      return () => cancelAnimationFrame(raf);
    }

    groundedRef.current = true;
    if (typeof onLoaded === 'function') {
      onLoaded(robot, alignedBox);
    }
    // 仅在 robot + meshesReady 首次齐备时贴地
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [robot, meshesReady, onLoaded]);

  // 关节轴 / 阴影开关变化时刷新外壳渲染模式
  useEffect(() => {
    if (!robot || !meshesReady) return;
    applyVisualShellAppearance(robot, {
      ghostMode: showJointAxes,
      shadowsEnabled: enableShadows,
    });
  }, [robot, meshesReady, showJointAxes, enableShadows]);

  // 仅为配置中的活动电机关节挂状态圆环（相机/雷达等 fixed 无电机、无状态）
  useEffect(() => {
    if (!robot?.joints) return;

    const motorUrdfNames = new Set(
      joints.map(({ urdfName }) => urdfName).filter(Boolean),
    );

    Object.entries(robot.joints).forEach(([urdfName, jointObj]) => {
      if (!motorUrdfNames.has(urdfName)) {
        // 非电机关节：若此前误挂了圆环则移除
        const existing = getDirectChildByName(jointObj, MARKER_NAME);
        if (existing) {
          jointObj.remove(existing);
          if (existing.geometry) existing.geometry.dispose();
          if (existing.material) existing.material.dispose();
        }
        return;
      }

      const marker = ensureJointMarker(jointObj);
      updateJointMarker(marker, statusByUrdfName[urdfName], {
        visible: showJointHealth,
      });
    });
  }, [
    robot,
    joints,
    statusByUrdfName,
    statusColors,
    showJointHealth,
  ]);

  // 关节轴辅助：每个 revolute/continuous 各挂一份，visible 跟随 showJointAxes（默认关）
  useEffect(() => {
    if (!robot?.joints || !meshesReady) return;

    Object.values(robot.joints).forEach((jointObj) => {
      const helper = ensureJointAxisHelper(jointObj);
      if (helper) {
        helper.visible = showJointAxes;
      }
    });
  }, [robot, meshesReady, showJointAxes]);

  // 根据 jointAngles 驱动 URDF 关节
  useEffect(() => {
    if (!robot || !joints.length) return;

    joints.forEach(({ id, urdfName }) => {
      if (!urdfName) return;
      const angleRad = jointAngles[id] != null ? jointAngles[id] : 0;

      if (typeof robot.setJointValue === 'function') {
        robot.setJointValue(urdfName, angleRad);
      } else if (
        robot.joints &&
        robot.joints[urdfName] &&
        typeof robot.joints[urdfName].setJointValue === 'function'
      ) {
        robot.joints[urdfName].setJointValue(angleRad);
      }
    });
  }, [robot, jointAngles, joints]);

  if (!robot) {
    return null;
  }

  return <primitive object={robot} />;
};

export default UrdfRobot;
