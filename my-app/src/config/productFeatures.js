/*
 * 产品模块能力统一入口。
 *
 * 对齐 robotUrdfConfig / controlCatalog：
 *   编译期按 REACT_APP_PRODUCT 选择一份能力表，
 *   控制侧栏、Operator 入口与路由是否暴露某模块。
 *
 * 约定：
 * - 模块级能力放这里（如 mapNavigation）
 * - 页内按钮/卡片仍走 controlCatalog
 * - 入口层用 hasFeature('xxx')，业务页内不做产品分支
 */
import { PRODUCT_FEATURES as LRS_X_FEATURES } from './lrs-x/productFeatures';
import { PRODUCT_FEATURES as LRD_W_FEATURES } from './lrd-w/productFeatures';

const PRODUCT_FEATURE_TABLE = {
  'lrs-x': LRS_X_FEATURES,
  'lrd-w': LRD_W_FEATURES,
};

const product = (process.env.REACT_APP_PRODUCT || 'lrs-x').trim();
const selected = PRODUCT_FEATURE_TABLE[product];

if (!selected) {
  throw new Error(
    `[roboview] 未知产品能力表 REACT_APP_PRODUCT="${product}"，可选: ${Object.keys(PRODUCT_FEATURE_TABLE).join(', ')}`
  );
}

/** 当前产品 id（与 URDF / controlCatalog 同源） */
export const FEATURE_PRODUCT = product;

/** 当前产品能力快照 */
export const PRODUCT_FEATURES = selected;

/** 是否开启某模块能力 */
export function hasFeature(key) {
  return Boolean(PRODUCT_FEATURES?.[key]);
}
