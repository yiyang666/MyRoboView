# NX 机器部署完整指南

本文档详细说明如何将前端和后端部署到 NX 机器上，包括环境配置、文件传输、Nginx 配置和故障排查。

## 📋 目录

- [前置条件](#前置条件)
- [后端部署](#后端部署)
- [前端部署](#前端部署)
- [Nginx 配置](#nginx-配置)
- [启动服务](#启动服务)
- [验证部署](#验证部署)
- [故障排查](#故障排查)

---

## 前置条件

1. **NX 机器环境**
   - 系统：Ubuntu 20.04+ 或兼容的 Linux 发行版
   - 网络：能够访问机器人系统（ROS2/DDS）
   - 权限：具有 sudo 权限

2. **编译产物准备**
   - 后端：`build/lrs-x/nx/install/` 目录（已编译）
   - 前端：需要先构建（见前端部署章节）

3. **依赖安装**
   - Drogon 框架（后端依赖）
   - Nginx（前端静态文件服务）

---

## 后端部署

### 1. 传输编译产物到 NX 机器

**方法 1：使用 scp（简单）**

```bash
# 在编译机器（x86）上执行
cd /home/ethan/workspace/robot/build_all

# 传输整个 install 目录
scp -r build/lrs-x/nx/install user@nx-ip:/tmp/roboview-install
```

**方法 2：使用 rsync（推荐，支持断点续传）**

```bash
rsync -avz --progress build/lrs-x/nx/install/ user@nx-ip:/tmp/roboview-install/
```

### 2. 在 NX 机器上部署后端文件

```bash
# 在 NX 机器上执行

# 创建部署目录结构
sudo mkdir -p /app/{bin,lib,etc}

# 复制可执行文件
sudo cp /tmp/roboview-install/bin/roboview /app/bin/
sudo chmod +x /app/bin/roboview

# 复制库文件
sudo cp -r /tmp/roboview-install/lib/* /app/lib/ 2>/dev/null || true

# 复制配置文件
sudo cp -r /tmp/roboview-install/etc/* /app/etc/ 2>/dev/null || true

# 设置库文件搜索路径
echo "/app/lib" | sudo tee /etc/ld.so.conf.d/roboview.conf
sudo ldconfig
```

### 3. 验证后端部署

```bash
# 检查文件是否存在
ls -lh /app/bin/roboview

# 检查依赖库
ldd /app/bin/roboview
```

---

## 前端部署

### ⚠️ 重要：前端不需要交叉编译

**原因**：
- React 前端编译成 JavaScript、HTML、CSS 等**纯文本静态文件**
- 这些文件运行在**浏览器**中，不涉及服务器端二进制代码
- **x86 环境下构建的前端可以在任何平台上运行**

### 1. 配置环境变量（关键步骤）

**⚠️ 重要：`.env` 文件中的环境变量会在构建时编译进代码！**

**生产环境部署（通过 Nginx）的正确配置：**

```bash
# 在编译机器上编辑 .env 文件
cd /home/ethan/workspace/robot/build_all/src/roboview/my-app
nano .env
```

**`.env` 文件内容（生产环境）：**

```bash
# React 开发服务器配置
HOST=0.0.0.0
PORT=3000

# ============================================
# 生产环境：注释掉 REACT_APP_API_URL 和 REACT_APP_WS_URL
# 让生产环境使用相对路径（通过 Nginx 代理）
# ============================================

# API 基础 URL（仅开发环境使用，生产环境请注释）
# REACT_APP_API_URL=http://10.107.12.129:8080

# WebSocket URL（仅开发环境使用，生产环境请注释）
# REACT_APP_WS_URL=ws://10.107.12.129:8080/ws
```

**为什么必须注释掉？**
- 如果设置了 `REACT_APP_API_URL`，IP 地址会被**硬编码**到构建产物中
- 部署后前端会尝试连接硬编码的 IP，而不是通过 Nginx 代理
- 生产环境应使用相对路径，由 Nginx 统一代理

### 2. 构建前端（在编译机器上）

```bash
cd /home/ethan/workspace/robot/build_all/src/roboview/my-app

# 清理旧构建产物
rm -rf build

# 构建生产版本（自动设置 NODE_ENV=production）
npm run build
```

**构建后的行为：**
- `apiConfig.js` 检测到 `NODE_ENV === 'production'`
- 由于没有 `REACT_APP_API_URL`，使用相对路径 `/api/`
- WebSocket 使用 `ws://当前页面host/ws`

### 3. 验证构建产物

```bash
# 检查是否包含硬编码 IP（不应该有）
grep -r "10.107.12.129" build/static/js/*.js || echo "✅ 未找到硬编码 IP"
grep -r "localhost:8080" build/static/js/*.js || echo "✅ 未找到 localhost"

# 检查是否使用相对路径（应该有）
grep -o "['\"]/api/v1" build/static/js/*.js | head -3
```

### 4. 传输前端文件到 NX 机器

```bash
# 在编译机器上执行
cd /home/ethan/workspace/robot/build_all/src/roboview/my-app

# 使用 rsync（推荐）
rsync -avz --progress build/ user@nx-ip:/tmp/roboview-frontend/

# 或使用 scp
scp -r build/* user@nx-ip:/tmp/roboview-frontend/
```

### 5. 在 NX 机器上部署前端文件

```bash
# 在 NX 机器上执行

# 创建前端部署目录
sudo mkdir -p /var/www/robot-monitor

# 复制前端文件
sudo cp -r /tmp/roboview-frontend/* /var/www/robot-monitor/

# 设置权限
sudo chown -R www-data:www-data /var/www/robot-monitor
sudo chmod -R 755 /var/www/robot-monitor
```

---

## Nginx 配置

### 一键自动安装（推荐）

在 NX 机器上执行以下命令即可自动完成安装、写配置、启用站点与重启：

```bash
# 将本仓库中的脚本拷贝到 NX 后执行（需 sudo）
sudo ./install_nginx.sh
```

脚本会：安装 Nginx（若未安装）→ 创建并写入 `robot-monitor` 站点配置 → 禁用默认站点并启用本配置 → 测试并重启 Nginx。

以下为等价的手动步骤，便于排查或自定义。

### 1. 安装 Nginx（如果未安装）

```bash
sudo apt-get update
sudo apt-get install -y nginx
```

### 2. 创建配置文件

```bash
# 在 NX 机器上执行
sudo nano /etc/nginx/sites-available/robot-monitor
```

**配置文件内容：**

```nginx
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
    
    # 机器人模型 mesh 资源：首次加载限速，后续强缓存，避免大文件传输影响实时进程
    location ~* \.(stl|dae|obj|glb)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        limit_rate 5m;
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
```

### 3. 启用配置

```bash
# 删除默认配置链接（如果存在）
sudo rm -f /etc/nginx/sites-enabled/default

# 创建符号链接启用我们的配置
sudo ln -s /etc/nginx/sites-available/robot-monitor /etc/nginx/sites-enabled/robot-monitor

# 测试配置
sudo nginx -t

# 重启 Nginx
sudo systemctl restart nginx
sudo systemctl enable nginx
```

### 4. 配置说明

**`server_name` 选项：**
- `server_name _;` - **推荐**：匹配所有请求，支持从其他机器访问
- `server_name localhost;` - 只能本机访问
- `server_name 192.168.1.100;` - 使用实际 IP 地址

**`proxy_pass` 配置：**
- `location /api/` 中：`proxy_pass http://localhost:8080;`（不要加 `/api/`）
- `location /ws` 中：`proxy_pass http://localhost:8080/ws;`（可以加路径）

---

## 启动服务

### 1. 启动后端服务

**方法 1：直接运行**

```bash
cd /app
./bin/roboview
```

**方法 2：使用 systemd 服务（推荐）**

```bash
# 创建服务文件
sudo nano /etc/systemd/system/roboview.service
```

**服务文件内容：**

```ini
[Unit]
Description=RoboView Backend Service
After=network.target

[Service]
Type=simple
User=your-user  # 替换为实际用户名
WorkingDirectory=/app
ExecStart=/app/bin/roboview
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
Environment="LD_LIBRARY_PATH=/app/lib:/usr/local/lib"

[Install]
WantedBy=multi-user.target
```

**启动服务：**

```bash
sudo systemctl daemon-reload
sudo systemctl start roboview
sudo systemctl enable roboview
sudo systemctl status roboview
```

### 2. 验证服务运行

```bash
# 检查后端进程
ps aux | grep roboview

# 检查端口监听（应该监听在 0.0.0.0:8080）
sudo netstat -tlnp | grep 8080

# 测试后端 API
curl http://localhost:8080/api/v1/status
```

---

## 验证部署

### 1. 检查后端

```bash
# 在 NX 机器上测试
curl http://localhost:8080/api/v1/status
# 应该返回 JSON 格式的机器人状态
```

### 2. 检查前端

```bash
# 在 NX 机器上测试
curl http://localhost/
# 应该返回 index.html 内容
```

### 3. 检查 Nginx 代理

```bash
# 在 NX 机器上测试
curl http://localhost/api/v1/status
# 应该返回与直接访问后端相同的结果
```

### 4. 从其他机器访问

```bash
# 在其他机器上访问（替换为 NX 机器的 IP）
curl http://192.168.55.1/

# 浏览器访问
# http://192.168.55.1/
```

### 5. 浏览器验证

1. 打开浏览器，访问 `http://nx-ip/`
2. 按 `F12` 打开开发者工具
3. 查看 **Console** 标签：应该没有错误
4. 查看 **Network** 标签：
   - `/api/v1/status` → 200 OK
   - `/ws` → 101 Switching Protocols（WebSocket 升级成功）

---

## 故障排查

### 问题 1：前端显示但没有数据

**症状**：页面可以访问，但显示 "Unknown" 或默认值

**排查步骤：**

1. **检查浏览器控制台（F12）**
   - 查看 Console 是否有错误
   - 查看 Network 标签中 `/api/` 和 `/ws` 请求状态

2. **检查后端是否运行**
   ```bash
   ps aux | grep roboview
   sudo netstat -tlnp | grep 8080
   ```

3. **检查后端监听地址**
   ```bash
   # 应该看到 0.0.0.0:8080，而不是 127.0.0.1:8080
   sudo netstat -tlnp | grep 8080
   ```

4. **检查 Nginx 配置**
   ```bash
   sudo nginx -t
   sudo tail -f /var/log/nginx/robot-monitor-error.log
   ```

### 问题 2：前端仍使用 localhost 连接

**症状**：浏览器控制台显示连接 `ws://localhost:8080/ws` 失败

**原因**：前端构建时 `.env` 文件中设置了 `REACT_APP_API_URL` 或 `REACT_APP_WS_URL`

**解决方案：**

1. **检查 `.env` 文件**（在编译机器上）
   ```bash
   cd /home/ethan/workspace/robot/build_all/src/roboview/my-app
   cat .env | grep REACT_APP
   # 应该看到这些行被注释掉
   ```

2. **重新构建前端**
   ```bash
   rm -rf build
   npm run build
   ```

3. **验证构建产物**
   ```bash
   grep -r "localhost:8080" build/static/js/*.js || echo "✅ 正确"
   ```

4. **重新部署到 NX 机器**

### 问题 3：API 请求返回 502 Bad Gateway

**原因**：后端未运行或 Nginx 代理配置错误

**解决方案：**

```bash
# 1. 检查后端是否运行
ps aux | grep roboview

# 2. 测试后端 API（绕过 Nginx）
curl http://localhost:8080/api/v1/status

# 3. 检查 Nginx 配置
sudo nginx -t
sudo tail -f /var/log/nginx/robot-monitor-error.log
```

### 问题 4：WebSocket 连接失败

**原因**：Nginx WebSocket 代理配置不正确

**解决方案：**

1. **检查 Nginx 配置中的 WebSocket 部分**
   ```bash
   sudo nano /etc/nginx/sites-available/robot-monitor
   # 确保 location /ws 配置正确
   ```

2. **重新加载 Nginx**
   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```

### 问题 5：后端无法启动

**问题：找不到共享库**

```bash
# 检查库文件
ldd /app/bin/roboview

# 添加库路径
export LD_LIBRARY_PATH=/app/lib:$LD_LIBRARY_PATH

# 或使用 ldconfig
echo "/app/lib" | sudo tee /etc/ld.so.conf.d/roboview.conf
sudo ldconfig
```

**问题：端口被占用**

```bash
# 查找占用 8080 端口的进程
sudo lsof -i :8080
sudo kill -9 <PID>
```

### 快速诊断命令

```bash
#!/bin/bash
# 在 NX 机器上执行

echo "=== 后端进程检查 ==="
ps aux | grep roboview | grep -v grep

echo -e "\n=== 端口监听检查 ==="
sudo netstat -tlnp | grep 8080

echo -e "\n=== 后端 API 测试 ==="
curl -s http://localhost:8080/api/v1/status | head -5

echo -e "\n=== Nginx 状态 ==="
sudo systemctl status nginx --no-pager | head -5

echo -e "\n=== Nginx 代理测试 ==="
curl -s http://localhost/api/v1/status | head -5

echo -e "\n=== 前端文件检查 ==="
ls -lh /var/www/robot-monitor/index.html
```

---

## 部署检查清单

### 后端部署
- [ ] 编译产物已传输到 NX 机器
- [ ] 文件已复制到 `/app/{bin,lib,etc}`
- [ ] 库文件路径已配置（`ldconfig`）
- [ ] 后端可执行文件有执行权限
- [ ] 后端可以启动并监听 `0.0.0.0:8080`

### 前端部署
- [ ] `.env` 文件中的 `REACT_APP_API_URL` 和 `REACT_APP_WS_URL` 已注释
- [ ] 前端已使用 `npm run build` 构建
- [ ] 构建产物中不包含硬编码 IP
- [ ] 前端文件已复制到 `/var/www/robot-monitor`
- [ ] 文件权限已正确设置（`www-data:www-data`）

### Nginx 配置
- [ ] 配置文件已创建在 `/etc/nginx/sites-available/robot-monitor`
- [ ] 符号链接已创建到 `/etc/nginx/sites-enabled/robot-monitor`
- [ ] 默认配置已删除（`sites-enabled/default`）
- [ ] Nginx 配置测试通过（`nginx -t`）
- [ ] Nginx 已重启并运行

### 服务验证
- [ ] 后端服务正在运行
- [ ] 后端 API 可以访问（`curl http://localhost:8080/api/v1/status`）
- [ ] Nginx 代理工作正常（`curl http://localhost/api/v1/status`）
- [ ] 前端页面可以访问（浏览器访问 `http://nx-ip/`）
- [ ] WebSocket 连接成功（浏览器控制台 Network 标签）
- [ ] 前端可以获取数据（页面显示机器人状态）

---

## 总结

**部署流程总结：**

1. ✅ **后端部署**：传输编译产物 → 复制到 `/app/` → 配置库路径
2. ✅ **前端配置**：注释 `.env` 中的生产环境变量 → 构建前端
3. ✅ **前端部署**：传输构建产物 → 复制到 `/var/www/robot-monitor`
4. ✅ **Nginx 配置**：创建配置文件 → 启用配置 → 重启服务
5. ✅ **启动服务**：启动后端服务 → 验证所有功能

**关键要点：**

- ⚠️ **前端不需要交叉编译**，x86 构建即可
- ⚠️ **生产环境必须注释 `.env` 中的 `REACT_APP_*` 变量**
- ⚠️ **后端必须监听 `0.0.0.0:8080`，不能是 `127.0.0.1:8080`**
- ⚠️ **Nginx `proxy_pass` 配置：`/api/` 不加路径，`/ws` 可以加路径**

---

**最后更新**: 2026-02-14
