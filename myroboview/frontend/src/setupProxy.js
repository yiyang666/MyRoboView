// CRA 5's package-level proxy fails with a loopback HOST. Use its supported
// middleware entry point and explicitly retain local Host validation.
const { createProxyMiddleware } = require('http-proxy-middleware');
module.exports = function setupProxy(app) {
  app.use((req, res, next) => {
    const host = (req.headers.host || '').split(':')[0];
    if (!['127.0.0.1', 'localhost'].includes(host)) {
      res.status(403).send('Local development host required');
      return;
    }
    next();
  });
  // CRA reserves /ws for hot reload; telemetry uses a distinct application path.
  app.use(createProxyMiddleware('/api/v1/telemetry', { target: 'http://127.0.0.1:8080', changeOrigin: true, ws: true }));
  app.use('/api', createProxyMiddleware({ target: 'http://127.0.0.1:8080', changeOrigin: true }));
  app.use('/nav_maps', createProxyMiddleware({ target: 'http://127.0.0.1:8080', changeOrigin: true }));
};
