/*
 * @Author: ethan.young Ethan.Yang2@lingyiitech.com
 * @Date: 2026-02-25 13:41:16
 * @LastEditors: ethan.young Ethan.Yang2@lingyiitech.com
 * @LastEditTime: 2026-07-27 17:45:35
 * @FilePath: /build_all/src/roboview/my-app/src/components/Robot3DView.js
 * @Description: 3D URDF 视口：工具条（关节健康 / 关节轴 / 阴影）+ 多方向照明
 */
import React, { useCallback, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import './Robot3DView.css';

import UrdfRobot from './UrdfRobot';
import { URDF_CONFIG } from '../config/robotUrdfConfig';

// ========== 场景外观与灯光（在这里微调背部亮度） ==========
// 相机约在 [5,2,3]，主光从前上打；再加半球光 + 后侧补光，避免背部死黑
const SCENE_STYLE = {
  background: '#1e1e2e',
  floor: 'rgb(64, 64, 81)',
  gridCenter: '#3d4f6b',
  gridLine: '#000000',
  // 半球环境光：天空/地面漫反射，整体提亮背面
  hemiSky: '#d0d8e8',
  hemiGround: '#404050',
  hemiIntensity: 0.95,
  // 主光（前上，可投阴影）
  keyIntensity: 1.05,
  keyPosition: [8, 12, 6],
  // 背面补光（不投阴影，专治背部过暗）
  fillIntensity: 0.65,
  fillPosition: [-9, 5, -7],
  // 侧上方轮廓光，拉开体积感
  rimIntensity: 0.4,
  rimPosition: [-3, 10, 8],
};

const Robot3DView = ({ jointAnglesForView, jointStatus }) => {
  const controlsRef = useRef();
  const robotRef = useRef(null);
  // 轨道中心：贴地后用包围盒中心更新
  const [orbitTarget, setOrbitTarget] = useState([0, 1, 0]);
  // 工具条：健康默认开 / 关节轴默认关（开则幽灵壳）/ 阴影默认开
  const [showJointHealth, setShowJointHealth] = useState(true);
  const [showJointAxes, setShowJointAxes] = useState(false);
  const [enableShadows, setEnableShadows] = useState(true);

  const { urdfPath, packages, joints } = URDF_CONFIG;
  const jointVisualStatus = jointStatus || {};

  const handleRobotLoaded = useCallback((urdfRobot, alignedBox) => {
    const box =
      alignedBox && !alignedBox.isEmpty()
        ? alignedBox
        : (() => {
            urdfRobot.updateMatrixWorld(true);
            return new THREE.Box3().setFromObject(urdfRobot, true);
          })();
    const center = box.getCenter(new THREE.Vector3());
    setOrbitTarget([center.x, center.y, center.z]);
    if (controlsRef.current) {
      controlsRef.current.target.set(center.x, center.y, center.z);
      controlsRef.current.update();
    }
  }, []);

  return (
    <div className="robot-3d-view">
      <div className="view-header">
        <h3>3D Robot Model (URDF)</h3>
      </div>
      <div className="canvas-container">
        <div className="view-toolbar" role="toolbar" aria-label="3D 视图开关">
          <button
            type="button"
            className={`view-toolbar-btn${showJointHealth ? ' is-active' : ''}`}
            title={showJointHealth ? '隐藏关节健康圆环' : '显示关节健康圆环'}
            aria-pressed={showJointHealth}
            onClick={() => setShowJointHealth((v) => !v)}
          >
            关节健康
          </button>
          <button
            type="button"
            className={`view-toolbar-btn${showJointAxes ? ' is-active' : ''}`}
            title={
              showJointAxes
                ? '隐藏关节轴（恢复不透明外壳）'
                : '显示关节轴（外壳改为半透明）'
            }
            aria-pressed={showJointAxes}
            onClick={() => setShowJointAxes((v) => !v)}
          >
            关节轴
          </button>
          <button
            type="button"
            className={`view-toolbar-btn${enableShadows ? ' is-active' : ''}`}
            title={enableShadows ? '关闭阴影' : '开启阴影'}
            aria-pressed={enableShadows}
            onClick={() => setEnableShadows((v) => !v)}
          >
            阴影
          </button>
        </div>
        <Canvas shadows={enableShadows}>
          <color attach="background" args={[SCENE_STYLE.background]} />
          <PerspectiveCamera makeDefault position={[5, 2, 3]} fov={15} />

          {/* 半球光：柔和环境，减轻单侧主光造成的背部死黑 */}
          <hemisphereLight
            args={[SCENE_STYLE.hemiSky, SCENE_STYLE.hemiGround, SCENE_STYLE.hemiIntensity]}
          />
          {/* 主光：前上方，负责造型与阴影 */}
          <directionalLight
            position={SCENE_STYLE.keyPosition}
            intensity={SCENE_STYLE.keyIntensity}
            castShadow={enableShadows}
          />
          {/* 背面补光：不投阴影，专补背部结构 */}
          <directionalLight
            position={SCENE_STYLE.fillPosition}
            intensity={SCENE_STYLE.fillIntensity}
            castShadow={false}
          />
          {/* 侧轮廓光 */}
          <directionalLight
            position={SCENE_STYLE.rimPosition}
            intensity={SCENE_STYLE.rimIntensity}
            castShadow={false}
          />

          <group>
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              position={[0, 0, 0]}
              receiveShadow={enableShadows}
            >
              <planeGeometry args={[40, 40]} />
              <meshStandardMaterial
                color={SCENE_STYLE.floor}
                roughness={0.95}
                metalness={0.05}
              />
            </mesh>
            <gridHelper
              args={[40, 40, SCENE_STYLE.gridCenter, SCENE_STYLE.gridLine]}
              position={[0, 0.001, 0]}
            />
            <UrdfRobot
              urdfPath={urdfPath}
              packages={packages}
              jointAngles={jointAnglesForView || {}}
              jointVisualStatus={jointVisualStatus}
              joints={joints}
              showJointHealth={showJointHealth}
              showJointAxes={showJointAxes}
              enableShadows={enableShadows}
              robotRef={robotRef}
              onLoaded={handleRobotLoaded}
            />
          </group>

          <OrbitControls
            ref={controlsRef}
            enablePan
            enableZoom
            enableRotate
            minDistance={2}
            maxDistance={10}
            target={orbitTarget}
          />
        </Canvas>
      </div>
    </div>
  );
};

export default Robot3DView;
