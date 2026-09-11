#!/bin/bash
# 快速诊断是否可以访问后端和前端脚本 - 在 NX 机器上运行

echo "=========================================="
echo "  前端后端部署nx问题诊断脚本"
echo "=========================================="
echo ""

echo "=== 1. 后端进程检查 ==="
if ps aux | grep -v grep | grep roboview > /dev/null; then
    echo "✅ 后端进程正在运行"
    ps aux | grep -v grep | grep roboview
else
    echo "❌ 后端进程未运行！"
    echo "   请启动后端：./roboview"
fi
echo ""

echo "=== 2. 端口监听检查 ==="
# 尝试使用 sudo，如果失败则使用普通权限
if sudo netstat -tlnp 2>/dev/null | grep 8080 > /dev/null 2>&1; then
    echo "✅ 端口 8080 正在监听"
    sudo netstat -tlnp 2>/dev/null | grep 8080
    # 检查是否监听在 0.0.0.0（允许外部访问）
    if sudo netstat -tlnp 2>/dev/null | grep 8080 | grep "0.0.0.0" > /dev/null; then
        echo "✅ 监听地址正确（0.0.0.0:8080，允许外部访问）"
    else
        echo "⚠️  警告：可能只监听在 127.0.0.1:8080，外部无法访问"
    fi
elif netstat -tln 2>/dev/null | grep 8080 > /dev/null 2>&1 || ss -tln 2>/dev/null | grep 8080 > /dev/null 2>&1; then
    echo "✅ 端口 8080 正在监听（使用普通权限检查）"
    netstat -tln 2>/dev/null | grep 8080 || ss -tln 2>/dev/null | grep 8080
    if netstat -tln 2>/dev/null | grep 8080 | grep "0.0.0.0" > /dev/null 2>&1 || ss -tln 2>/dev/null | grep 8080 | grep "0.0.0.0" > /dev/null 2>&1; then
        echo "✅ 监听地址正确（0.0.0.0:8080，允许外部访问）"
    else
        echo "⚠️  警告：可能只监听在 127.0.0.1:8080，外部无法访问"
    fi
else
    echo "❌ 端口 8080 未监听！"
    echo "   后端可能未启动或启动失败"
fi
echo ""

echo "=== 3. 后端 API 直接测试（绕过 Nginx）==="
if curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/v1/status 2>/dev/null | grep -q "200"; then
    echo "✅ 后端 API 响应正常"
    echo "   响应内容："
    curl -s http://localhost:8080/api/v1/status | head -5
else
    echo "❌ 后端 API 无响应！"
    echo "   状态码：$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/api/v1/status 2>/dev/null)"
fi
echo ""

echo "=== 4. Nginx 状态检查 ==="
if systemctl is-active --quiet nginx; then
    echo "✅ Nginx 正在运行"
    systemctl status nginx --no-pager | head -5
else
    echo "❌ Nginx 未运行！"
    echo "   请启动：sudo systemctl start nginx"
fi
echo ""

echo "=== 5. Nginx 配置语法检查 ==="
nginx_test_output=$(sudo nginx -t 2>&1)
if echo "$nginx_test_output" | grep -q "successful"; then
    echo "✅ Nginx 配置语法正确"
elif echo "$nginx_test_output" | grep -q "Permission denied\|password is required"; then
    echo "⚠️  无法检查 Nginx 配置（需要 sudo 权限）"
    # 如果 Nginx 正在运行，说明配置应该是正确的
    if systemctl is-active --quiet nginx; then
        echo "   ✅ Nginx 正在运行，说明配置应该是正确的"
    else
        echo "   ⚠️  Nginx 未运行，请检查配置"
    fi
    echo "   如需手动检查，请运行：sudo nginx -t"
else
    echo "❌ Nginx 配置有错误！"
    echo "$nginx_test_output"
fi
echo ""

echo "=== 6. Nginx 代理测试（通过 Nginx 访问后端）==="
if curl -s -o /dev/null -w "%{http_code}" http://localhost/api/v1/status 2>/dev/null | grep -q "200"; then
    echo "✅ Nginx 代理工作正常"
    echo "   响应内容："
    curl -s http://localhost/api/v1/status | head -5
else
    echo "❌ Nginx 代理失败！"
    echo "   状态码：$(curl -s -o /dev/null -w "%{http_code}" http://localhost/api/v1/status 2>/dev/null)"
    echo "   可能原因："
    echo "   - Nginx 配置中的 proxy_pass 错误"
    echo "   - 后端未运行"
fi
echo ""

echo "=== 7. 前端文件检查 ==="
if [ -f "/var/www/robot-monitor/index.html" ]; then
    echo "✅ 前端文件存在"
    echo "   文件路径：/var/www/robot-monitor"
    echo "   文件数量：$(find /var/www/robot-monitor -type f | wc -l)"
else
    echo "❌ 前端文件不存在！"
    echo "   请检查：/var/www/robot-monitor/index.html"
fi
echo ""

echo "=== 8. 防火墙检查 ==="
if command -v ufw > /dev/null; then
    ufw_status=$(sudo ufw status 2>/dev/null | head -1)
    if echo "$ufw_status" | grep -q "inactive"; then
        echo "✅ 防火墙未启用"
    else
        echo "⚠️  防火墙已启用"
        echo "   状态：$ufw_status"
        echo "   请确保允许 80 和 8080 端口："
        echo "   sudo ufw allow 80/tcp"
        echo "   sudo ufw allow 8080/tcp"
    fi
else
    echo "ℹ️  未安装 ufw，跳过防火墙检查"
fi
echo ""

echo "=== 9. Nginx 错误日志（最近 10 行）==="
if [ -f "/var/log/nginx/robot-monitor-error.log" ]; then
    echo "最近错误："
    if sudo tail -10 /var/log/nginx/robot-monitor-error.log 2>/dev/null; then
        :
    elif tail -10 /var/log/nginx/robot-monitor-error.log 2>/dev/null; then
        :
    else
        echo "⚠️  无法读取错误日志（需要权限）"
        echo "   请运行：sudo tail -10 /var/log/nginx/robot-monitor-error.log"
    fi
else
    echo "⚠️  错误日志文件不存在：/var/log/nginx/robot-monitor-error.log"
    echo "   请检查 Nginx 配置中的 error_log 路径"
fi
echo ""

echo "=== 10. 网络连通性测试 ==="
echo "测试从本机访问："
if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1/api/v1/status 2>/dev/null | grep -q "200"; then
    echo "✅ 本机访问正常"
else
    echo "❌ 本机访问失败"
fi

# 获取本机 IP（如果有多个，只显示第一个）
local_ip=$(hostname -I | awk '{print $1}' 2>/dev/null)
if [ -n "$local_ip" ]; then
    echo "测试从 IP $local_ip 访问："
    if curl -s -o /dev/null -w "%{http_code}" http://$local_ip/api/v1/status 2>/dev/null | grep -q "200"; then
        echo "✅ IP 访问正常"
    else
        echo "❌ IP 访问失败"
    fi
fi
echo ""

echo "=========================================="
echo "  诊断完成"
echo "=========================================="
echo ""
echo "下一步操作："
echo "1. 如果后端未运行，请启动：./roboview"
echo "2. 如果 Nginx 未运行，请启动：sudo systemctl start nginx"
echo "3. 如果配置有错误，请检查：sudo nano /etc/nginx/sites-available/robot-monitor"
echo "4. 在浏览器中打开开发者工具（F12），查看 Console 和 Network 标签的错误信息"
echo "5. 详细排查步骤请参考：TROUBLESHOOTING.md"
