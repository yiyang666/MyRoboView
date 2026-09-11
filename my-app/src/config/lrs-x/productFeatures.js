/**
 * LRS-X 产品模块能力表。
 * 页面入口（侧栏 / Operator / 路由）只读 hasFeature，不在业务组件里散落产品判断。
 */
export const PRODUCT_FEATURES = {
  /** 地图导航：本产品暂不支持，入口隐藏且深链 Redirect */
  mapNavigation: false,
};
