/*
 * Vite 配置 —— roboview 前端构建唯一入口
 *
 * 职责（完整承接原 CRA + src/setupProxy.js 的行为）：
 * 1. 开发服务器：仅监听回环地址（默认 127.0.0.1，可用 HOST 覆盖），固定 3000 端口
 * 2. 反向代理：/api、/nav_maps 转发到后端 :8080；/api/v1/telemetry 为 WebSocket
 * 3. 产品差异化：REACT_APP_PRODUCT（与后端 AI_TARGET_PRODUCT / 外层 Makefile PRODUCT 对齐）
 *    - 经 envPrefix 暴露为 import.meta.env.REACT_APP_PRODUCT，构建期静态替换进包
 *    - 同时决定 build.outDir = build/<产品>，双产品交替构建互不覆盖
 * 4. 产物布局：assetsDir=static，与 CMake 安装规则（etc/web/static 独占清理）对齐，
 *    避免与 etc/web/assets/（URDF、地图等后端资源）混放
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 与原 src/setupProxy.js 等价的回环校验：拒绝非本机 Host 头，防 DNS 重绑定
function loopbackOnly() {
  return {
    name: 'roboview-loopback-only',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const host = (req.headers.host || '').split(':')[0];
        if (!['127.0.0.1', 'localhost'].includes(host)) {
          res.statusCode = 403;
          res.end('Local development host required');
          return;
        }
        next();
      });
    },
  };
}

// 后端开发地址（与 backend/config/<产品>/myroboview.json 的 server.port 对齐）
const BACKEND = 'http://127.0.0.1:8080';

export default defineConfig(() => {
  // 注意：本文件运行在 Node 侧，可直接读 process.env；浏览器侧源码请用 import.meta.env
  const product = (process.env.REACT_APP_PRODUCT || 'lrs-x').trim();
  return {
    plugins: [react(), loopbackOnly()],
    // 保留历史变量名 REACT_APP_*：CMake / start_dev.sh 的注入接口不变
    envPrefix: 'REACT_APP_',
    server: {
      host: process.env.HOST || '127.0.0.1',
      port: 3000,
      strictPort: true, // 3000 被占时直接报错，交由 start_dev.sh 提示处理
      proxy: {
        // WebSocket 通道必须先于 /api 声明（按对象键顺序做前缀匹配）
        '/api/v1/telemetry': { target: BACKEND, changeOrigin: true, ws: true },
        '/api': { target: BACKEND, changeOrigin: true },
        '/nav_maps': { target: BACKEND, changeOrigin: true },
      },
    },
    build: {
      outDir: `build/${product}`,
      emptyOutDir: true,   // 每次构建清空本产品目录，避免旧哈希文件累积
      assetsDir: 'static', // → build/<产品>/static/，安装时落到 etc/web/static/
      sourcemap: false,
    },
  };
});
