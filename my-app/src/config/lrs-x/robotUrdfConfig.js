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

// LRS-X 机器人配置
export const URDF_CONFIG = {
  id: 'lrs-x',
  displayName: '领益小人形机器人',

  // URDF 静态资源路径（扁平）：开发态拷贝到 public/robot_urdf/；
  // 安装态由 CMake 将 assets/<product>/robot_urdf 装到 etc/web/robot_urdf/
  urdfPath: '/robot_urdf/LRS-X2URDF.urdf',

  // package:// 前缀到静态资源目录的映射（与 URDF 内 package 名一致）
  packages: {
    'lrs-x': '/robot_urdf/',
  },

  // 关节统一配置（合并 jointIdToUrdf + jointList）
  // - 后端 joint id -> URDF 关节名
  // - 同时保留前端显示名
  // 注意：限位由 URDF 文件提供（单位弧度），前端 slider 与 URDF 驱动均使用弧度
  joints: [
    { id: 0, name: '左腿PITCH', urdfName: 'left_hippitch_Joint' },
    { id: 1, name: '左腿ROLL', urdfName: 'left_hiproll_Joint' },
    { id: 2, name: '左腿YAW', urdfName: 'left_hipyaw_Joint' },
    { id: 3, name: '左腿KNEE', urdfName: 'left_knee_Joint' },
    { id: 4, name: '左腿LEG-HIGH', urdfName: 'left_anklepitch_Joint' },
    { id: 5, name: '左腿LEG-LOW', urdfName: 'left_ankleroll_Joint' },

    { id: 6, name: '右腿PITCH', urdfName: 'right_hippitch_Joint' },
    { id: 7, name: '右腿ROLL', urdfName: 'right_hiproll_Joint' },
    { id: 8, name: '右腿YAW', urdfName: 'right_hipyaw_Joint' },
    { id: 9, name: '右腿KNEE', urdfName: 'right_knee_Joint' },
    { id: 10, name: '右腿LEG-HIGH', urdfName: 'right_anklepitch_Joint' },
    { id: 11, name: '右腿LEG-LOW', urdfName: 'right_ankleroll_Joint' },

    { id: 12, name: '腰部LEFT', urdfName: 'waist_pitch_Joint' },
    { id: 13, name: '腰部RIGHT', urdfName: 'waist_roll_Joint' },
    { id: 14, name: '腰部YAW', urdfName: 'waist_yaw_Joint' },

    { id: 15, name: '左手PITCH', urdfName: 'left_handpitch_Joint' },
    { id: 16, name: '左手ROLL', urdfName: 'left_handroll_Joint' },
    { id: 17, name: '左手YAW', urdfName: 'left_handyaw_Joint' },
    { id: 18, name: '左手ELBOW', urdfName: 'left_handelbow_Joint' },
    { id: 19, name: '左手小YAW', urdfName: 'left_handwrist_Joint' },

    { id: 20, name: '右手PITCH', urdfName: 'right_handpitch_Joint' },
    { id: 21, name: '右手ROLL', urdfName: 'right_handroll_Joint' },
    { id: 22, name: '右手YAW', urdfName: 'right_handyaw_Joint' },
    { id: 23, name: '右手ELBOW', urdfName: 'right_handelbow_Joint' },
    { id: 24, name: '右手小YAW', urdfName: 'right_handwrist_Joint' },

    { id: 25, name: '头部HEAD', urdfName: 'head_Joint' },
  ],
};

// 帮助函数：根据 id 获取 URDF 关节名
export function getUrdfJointNameById(id) {
  const joint = URDF_CONFIG.joints?.find((j) => Number(j.id) === Number(id));
  return joint?.urdfName || null;
}

