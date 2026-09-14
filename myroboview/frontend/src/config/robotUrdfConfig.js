/*
 * 机器人 URDF 配置中心
 *
 * 目标：
 * - 把与具体机器人模型相关的所有配置集中在一处，便于更换/复用
 * - 包括：URDF 路径、package 映射、关节 ID -> URDF 名、关节显示名、关节角度限位等
 *
 * 后续如果有新的机器人（例如 robotB），可以在这里新增一个 config：
 *   export const ROBOTB_URDF_CONFIG = { ... };
 */

// LRD-W 四足机器人配置（对齐 LRD_W01.urdf）
export const URDF_CONFIG = {
  id: 'lrd-w',
  displayName: '领益四足移动机器人',

  // 沿用原版静态加载路径约定。原始资源保存在 frontend/assert/lrd-w/robot_urdf。
  // 当前仅使用关节名称映射，不复制 meshes、不请求 URDF、不挂载 3D viewer。
  urdfPath: '/robot_urdf/LRD_W01.urdf',

  // package:// 前缀到静态资源目录的映射（与 URDF 内 package 名一致）
  packages: {
    'lrd-w': '/robot_urdf/',
  },

  // 关节统一配置
  // - 后端 joint id -> URDF 关节名（与 LRD_W01.urdf / motor_count:16 对齐）
  // - 顺序：FR → FL → RR → RL，每腿 hip / thigh / calf / wheel
  // - 同时保留前端显示名
  // 注意：限位由 URDF 文件提供（单位弧度），前端 slider 与 URDF 驱动均使用弧度
  // 固定关节（IMU / Camera / Lidar）不参与电机映射，故不列入
  joints: [
    // 右前腿 FR
    { id: 0, name: '右前HIP', urdfName: 'FR_hip_joint' },
    { id: 1, name: '右前THIGH', urdfName: 'FR_thigh_joint' },
    { id: 2, name: '右前CALF', urdfName: 'FR_calf_joint' },
    { id: 3, name: '右前WHEEL', urdfName: 'FR_wheel_joint' },

    // 左前腿 FL
    { id: 4, name: '左前HIP', urdfName: 'FL_hip_joint' },
    { id: 5, name: '左前THIGH', urdfName: 'FL_thigh_joint' },
    { id: 6, name: '左前CALF', urdfName: 'FL_calf_joint' },
    { id: 7, name: '左前WHEEL', urdfName: 'FL_wheel_joint' },

    // 右后腿 RR
    { id: 8, name: '右后HIP', urdfName: 'RR_hip_joint' },
    { id: 9, name: '右后THIGH', urdfName: 'RR_thigh_joint' },
    { id: 10, name: '右后CALF', urdfName: 'RR_calf_joint' },
    { id: 11, name: '右后WHEEL', urdfName: 'RR_wheel_joint' },

    // 左后腿 RL
    { id: 12, name: '左后HIP', urdfName: 'RL_hip_joint' },
    { id: 13, name: '左后THIGH', urdfName: 'RL_thigh_joint' },
    { id: 14, name: '左后CALF', urdfName: 'RL_calf_joint' },
    { id: 15, name: '左后WHEEL', urdfName: 'RL_wheel_joint' },


  ],
};

// 帮助函数：根据 id 获取 URDF 关节名
export function getUrdfJointNameById(id) {
  const joint = URDF_CONFIG.joints?.find((j) => Number(j.id) === Number(id));
  return joint?.urdfName || null;
}
