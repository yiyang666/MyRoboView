#!/bin/bash
# Nginx 自动安装与 robot-monitor 配置脚本
# 对应 NX_DEPLOYMENT_GUIDE.md 中的 Nginx 配置流程
# 需在 NX 机器上以 root 或 sudo 执行

set -e

CONFIG_NAME="robot-monitor"
SITES_AVAILABLE="/etc/nginx/sites-available/${CONFIG_NAME}"
SITES_ENABLED="/etc/nginx/sites-enabled/${CONFIG_NAME}"

echo "=== Nginx robot-monitor 自动安装配置 ==="

# 1. 安装 Nginx（如果未安装）
if ! command -v nginx &>/dev/null; then
    echo "[1/4] 安装 Nginx..."
    apt-get update
    apt-get install -y nginx
else
    echo "[1/4] Nginx 已安装，跳过."
fi

# 2. 创建配置文件
echo "[2/4] 写入配置文件: ${SITES_AVAILABLE}"
cat << 'NGINX_EOF' | tee "${SITES_AVAILABLE}" > /dev/null
server {
    listen 80;
    server_name _;  # 下划线表示匹配所有请求，支持从其他机器访问

    # 前端静态文件
    root /app/etc/web;
    index index.html;

    # 前端路由支持（React Router）
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 静态资源缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # API 反向代理到后端，
    # 若只监听IPV4,用127.0.0.1 而避免使用 http://localtion:8080
    location /api/ {
        proxy_pass http://127.0.0.1:8080;  # 注意：不要加 /api/
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket 代理
    location /ws {
        proxy_pass http://127.0.0.1:8080/ws;  # WebSocket 可以加路径
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    # 日志
    access_log /var/log/nginx/robot-monitor-access.log;
    error_log /var/log/nginx/robot-monitor-error.log;
    
    # 启用 Gzip 压缩
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss;
}
NGINX_EOF

# 3. 启用配置
echo "[3/4] 启用站点配置..."
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/${CONFIG_NAME} /etc/nginx/sites-enabled/${CONFIG_NAME}

# 4. 测试并重启 Nginx
echo "[4/4] 测试配置并重启 Nginx..."
if nginx -t; then
    systemctl restart nginx
    systemctl enable nginx
    echo ""
    echo "=== 完成 ==="
    echo "Nginx 已安装并配置 robot-monitor 站点。"
    echo "前端根目录: /app/etc/web"
    echo "API 代理: /api/ -> http://127.0.0.1:8080"
    echo "WebSocket: /ws -> http://127.0.0.1:8080/ws"
else
    echo "错误: nginx -t 失败，未重启服务。请检查 ${SITES_AVAILABLE}"
    exit 1
fi
