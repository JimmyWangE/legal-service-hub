#!/bin/bash
# 诊断和修复脚本

echo "========================================="
echo "法律服务平台诊断工具"
echo "========================================="
echo ""

# 1. 检查进程
echo "1. 检查进程状态..."
ps aux | grep -E "(uvicorn|python.*app|node.*server)" | grep -v grep
echo ""

# 2. 检查端口
echo "2. 检查端口监听..."
netstat -tlnp 2>/dev/null | grep -E ":(189|8000|4173)" || ss -tlnp | grep -E ":(189|8000|4173)"
echo ""

# 3. 测试后端健康
echo "3. 测试后端API..."
curl -s http://127.0.0.1:8000/health/live && echo "✅ 后端存活" || echo "❌ 后端无响应"
curl -s http://127.0.0.1:8000/health/ready && echo "✅ 后端就绪" || echo "❌ 后端未就绪"
echo ""

# 4. 测试前端
echo "4. 测试前端服务..."
curl -s -I http://127.0.0.1:189/ | head -1 || echo "❌ 前端189端口无响应"
curl -s -I http://127.0.0.1:4173/ | head -1 || echo "提示: 前端4173端口无响应(可能正常)"
curl -s -I http://172.22.3.76:189/ | head -1 || echo "❌ 前端公网IP无响应"
echo ""

# 5. 检查systemd服务
echo "5. 检查systemd服务状态..."
systemctl is-active legal-service-hub-api && echo "✅ API服务运行中" || echo "❌ API服务未运行"
systemctl is-active legal-service-hub-worker && echo "✅ Worker服务运行中" || echo "❌ Worker服务未运行"
systemctl is-active legal-service-hub && echo "✅ 前端服务运行中" || echo "❌ 前端服务未运行"
echo ""

# 6. 查看最近的日志错误
echo "6. 检查最近的错误日志..."
echo "--- API日志 (最近10行) ---"
journalctl -u legal-service-hub-api -n 10 --no-pager 2>/dev/null || echo "无法读取API日志"
echo ""
echo "--- 前端日志 (最近10行) ---"
journalctl -u legal-service-hub -n 10 --no-pager 2>/dev/null || echo "无法读取前端日志"
echo ""

# 7. 建议的修复步骤
echo "========================================="
echo "可能的问题和解决方案:"
echo "========================================="
echo ""
echo "问题1: 前端监听127.0.0.1而不是0.0.0.0"
echo "  → systemd服务需要设置 HOST=0.0.0.0 PORT=189"
echo ""
echo "问题2: 后端服务未启动或响应超时"
echo "  → sudo systemctl restart legal-service-hub-api"
echo ""
echo "问题3: 数据库连接失败"
echo "  → 检查backend/app/core/config.py中的数据库URL"
echo ""
echo "========================================="
echo "快速修复命令:"
echo "========================================="
echo "sudo systemctl restart legal-service-hub-api legal-service-hub-worker legal-service-hub"
echo "然后访问: http://172.22.3.76:189/"
echo ""
