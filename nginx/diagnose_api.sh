#!/bin/bash
# API 404 错误诊断脚本 - 在 NX 机器上运行

echo "=========================================="
echo "  API 404 错误诊断"
echo "=========================================="
echo ""

echo "=== 1. 检查后端服务状态 ==="
if ps aux | grep -v grep | grep roboview > /dev/null; then
    echo "✅ 后端进程正在运行"
    ps aux | grep -v grep | grep roboview
else
    echo "❌ 后端进程未运行！"
    echo "   请启动后端：./roboview 或 sudo systemctl start roboview"
fi
echo ""

echo "=== 2. 检查后端端口监听 ==="
if sudo netstat -tlnp 2>/dev/null | grep 8080 > /dev/null; then
    echo "✅ 端口 8080 正在监听"
    sudo netstat -tlnp 2>/dev/null | grep 8080
else
    echo "❌ 端口 8080 未监听！"
fi
echo ""

echo "=== 3. 测试后端 API（直接访问，绕过 Nginx）==="
echo "测试: http://localhost:8080/api/v1/files/list?type=log&page=1&pageSize=10"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:8080/api/v1/files/list?type=log&page=1&pageSize=10" 2>/dev/null)
if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ 后端 API 响应正常 (HTTP $HTTP_CODE)"
    echo "响应内容："
    curl -s "http://localhost:8080/api/v1/files/list?type=log&page=1&pageSize=10" | head -20
elif [ "$HTTP_CODE" = "404" ]; then
    echo "❌ 后端 API 返回 404"
    echo "   可能原因："
    echo "   - 路由未正确注册"
    echo "   - 后端代码未重新编译"
    echo "   - 后端服务需要重启"
else
    echo "⚠️  后端 API 返回 HTTP $HTTP_CODE"
    echo "响应内容："
    curl -s "http://localhost:8080/api/v1/files/list?type=log&page=1&pageSize=10" | head -20
fi
echo ""

echo "=== 4. 检查 Nginx 状态 ==="
if systemctl is-active --quiet nginx; then
    echo "✅ Nginx 正在运行"
else
    echo "❌ Nginx 未运行！"
fi
echo ""

echo "=== 5. 测试 Nginx 代理（通过 Nginx 访问）==="
echo "测试: http://localhost/api/v1/files/list?type=log&page=1&pageSize=10"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost/api/v1/files/list?type=log&page=1&pageSize=10" 2>/dev/null)
if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Nginx 代理工作正常 (HTTP $HTTP_CODE)"
elif [ "$HTTP_CODE" = "404" ]; then
    echo "❌ Nginx 代理返回 404"
    echo "   可能原因："
    echo "   - Nginx 配置中的 proxy_pass 错误"
    echo "   - 后端服务未运行"
    echo "   - Nginx 配置未重新加载"
else
    echo "⚠️  Nginx 代理返回 HTTP $HTTP_CODE"
fi
echo ""

echo "=== 6. 检查 Nginx 配置 ==="
if [ -f "/etc/nginx/sites-available/robot-monitor" ]; then
    echo "✅ 配置文件存在"
    echo "检查 location /api/ 配置："
    grep -A 10 "location /api/" /etc/nginx/sites-available/robot-monitor | head -12
else
    echo "❌ 配置文件不存在：/etc/nginx/sites-available/robot-monitor"
fi
echo ""

echo "=== 7. 检查 Nginx 错误日志（最近 20 行）==="
if [ -f "/var/log/nginx/robot-monitor-error.log" ]; then
    echo "最近错误："
    sudo tail -20 /var/log/nginx/robot-monitor-error.log
else
    echo "⚠️  错误日志文件不存在"
fi
echo ""

echo "=== 8. 检查后端日志 ==="
echo "如果使用 systemd，查看服务日志："
echo "  sudo journalctl -u roboview -n 50 --no-pager"
echo ""

echo "=========================================="
echo "  诊断完成"
echo "=========================================="
echo ""
echo "常见解决方案："
echo "1. 如果后端 API 直接访问返回 404："
echo "   - 检查后端代码是否重新编译"
echo "   - 重启后端服务：sudo systemctl restart roboview"
echo ""
echo "2. 如果后端 API 正常但 Nginx 代理返回 404："
echo "   - 检查 Nginx 配置：sudo nano /etc/nginx/sites-available/robot-monitor"
echo "   - 确保 location /api/ 中的 proxy_pass 指向 http://localhost:8080"
echo "   - 重新加载 Nginx：sudo systemctl reload nginx"
echo ""
echo "3. 如果后端服务未运行："
echo "   - 启动后端：./roboview 或 sudo systemctl start roboview"
