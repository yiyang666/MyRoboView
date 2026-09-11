/**
 * API 配置工具
 *
 * 核心价值：
 * 1. 统一管理 API 配置，避免硬编码（解决其他电脑无法访问的问题）
 * 2. 生产环境自动适配 nginx（使用相对路径）
 * 3. 支持环境变量覆盖（.env 文件）
 *
 * 使用场景：
 * - 开发环境（本机）：API 走相对路径 + package.json proxy；WS 直连当前主机:8080
 * - 开发环境（局域网 --lan）：用 window.location.hostname，外机访问 IP 时 WS 也连到开发机
 * - 开发环境（覆盖）：配置 .env 中的 REACT_APP_API_URL 和 REACT_APP_WS_URL
 * - 生产环境（nginx）：自动使用相对路径，无需配置（不影响部署）
 */

// 获取 API 基础 URL
export const getApiBaseUrl = () => {
  // 优先使用环境变量
  if (process.env.REACT_APP_API_URL) {
    return process.env.REACT_APP_API_URL;
  }

  // 默认始终优先走同源相对路径：
  // - 生产环境由 nginx 代理到后端
  // - 开发环境由 CRA package.json 的 proxy 转发到 8080
  // 这样可以避免把请求硬编码到 localhost，导致“前端可访问但 API Failed to fetch”
  return '';
};

// 获取 WebSocket URL（不含 token）
export const getWebSocketUrl = () => {
  // 优先使用环境变量
  if (process.env.REACT_APP_WS_URL) {
    return process.env.REACT_APP_WS_URL;
  }

  // 生产环境：跟随当前页面主机，由 nginx 统一代理 /ws
  if (process.env.NODE_ENV === 'production') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/ws`;
  }

  // 开发环境：直连后端 8080（不要走 3000 同源；CRA 对 /ws 代理不稳定）。
  // 用当前页面 hostname：本机 localhost 访问仍连 localhost:8080；
  // --lan 下用 IP 打开时连 该IP:8080，避免写死 localhost 导致外机 WS 连到自己。
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const hostname = window.location.hostname || 'localhost';
  return `${protocol}//${hostname}:8080/ws`;
};
