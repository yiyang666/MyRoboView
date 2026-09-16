/*
 * 产品 URDF 配置统一入口。
 *
 * 通过环境变量选择产品（与后端 AI_TARGET_PRODUCT / Makefile PRODUCT 对齐）：
 *   REACT_APP_PRODUCT=lrs-x|lrd-w
 *
 * Vite 通过 envPrefix: 'REACT_APP_'（见 frontend/vite.config.js）
 * 在编译期把 REACT_APP_* 静态替换进包。
 * 未设置时默认 lrs-x。
 *
 * 业务代码请统一：
 *   import { URDF_CONFIG } from '../config/robotUrdfConfig';
 */
import { URDF_CONFIG as LRS_X_CONFIG } from './lrs-x/robotUrdfConfig';
import { URDF_CONFIG as LRD_W_CONFIG } from './lrd-w/robotUrdfConfig';

const PRODUCT_CONFIGS = {
  'lrs-x': LRS_X_CONFIG,
  'lrd-w': LRD_W_CONFIG,
};

// Vite 构建期静态替换（浏览器侧无 process.env，须用 import.meta.env）
const product = (import.meta.env.REACT_APP_PRODUCT || 'lrs-x').trim();
const selected = PRODUCT_CONFIGS[product];

if (!selected) {
  throw new Error(
    `[roboview] 未知产品 REACT_APP_PRODUCT="${product}"，可选: ${Object.keys(PRODUCT_CONFIGS).join(', ')}`
  );
}

export const ROBOVIEW_PRODUCT = product;
export const URDF_CONFIG = selected;

// 帮助函数：根据 id 获取当前产品 URDF 关节名
export function getUrdfJointNameById(id) {
  const joint = URDF_CONFIG.joints?.find((j) => Number(j.id) === Number(id));
  return joint?.urdfName || null;
}
