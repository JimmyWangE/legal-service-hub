#!/bin/bash
# 一键诊断和修复脚本

set -e

echo "========================================="
echo "法律服务平台 - 一键修复脚本"
echo "========================================="
echo ""

# 第1步：检查当前配置
echo "📋 第1步：检查systemd服务配置..."
echo ""
echo "--- 当前legal-service-hub.service配置 ---"
sudo cat /etc/systemd/system/legal-service-hub.service
echo ""
echo "按Enter继续..."
read

# 第2步：检查是否有环境变量
echo ""
echo "🔍 第2步：检查环境变量配置..."
if sudo grep -q "Environment.*PORT" /etc/systemd/system/legal-service-hub.service; then
    echo "✅ 发现PORT环境变量配置"
    sudo grep "Environment.*PORT" /etc/systemd/system/legal-service-hub.service
else
    echo "❌ 未发现PORT环境变量配置"
fi

if sudo grep -q "Environment.*HOST" /etc/systemd/system/legal-service-hub.service; then
    echo "✅ 发现HOST环境变量配置"
    sudo grep "Environment.*HOST" /etc/systemd/system/legal-service-hub.service
else
    echo "❌ 未发现HOST环境变量配置"
fi
echo ""

# 第3步：询问是否需要修复
echo "========================================="
echo "是否需要修复配置？(y/n)"
echo "========================================="
read -p "输入 y 继续修复，n 跳过: " answer

if [ "$answer" != "y" ]; then
    echo "跳过修复，退出。"
    exit 0
fi

# 第4步：备份原配置
echo ""
echo "💾 第4步：备份原配置..."
sudo cp /etc/systemd/system/legal-service-hub.service /etc/systemd/system/legal-service-hub.service.backup.$(date +%Y%m%d_%H%M%S)
echo "✅ 备份完成"
echo ""

# 第5步：修复配置
echo "🔧 第5步：修复服务配置..."

# 检查是否已存在Environment配置
if sudo grep -q "^\[Service\]" /etc/systemd/system/legal-service-hub.service; then
    # 删除旧的HOST和PORT配置（如果存在）
    sudo sed -i '/^Environment="HOST=/d' /etc/systemd/system/legal-service-hub.service
    sudo sed -i '/^Environment="PORT=/d' /etc/systemd/system/legal-service-hub.service
    sudo sed -i '/^Environment="API_UPSTREAM=/d' /etc/systemd/system/legal-service-hub.service

    # 在[Service]后添加新配置
    sudo sed -i '/^\[Service\]/a Environment="HOST=0.0.0.0"\nEnvironment="PORT=189"\nEnvironment="API_UPSTREAM=http://127.0.0.1:8000"' /etc/systemd/system/legal-service-hub.service

    echo "✅ 配置已更新"
else
    echo "❌ 未找到[Service]段，请手动编辑"
    exit 1
fi
echo ""

# 第6步：显示新配置
echo "📋 新配置内容："
sudo cat /etc/systemd/system/legal-service-hub.service
echo ""

# 第7步：重新加载并重启
echo "🔄 第6步：重新加载systemd并重启服务..."
sudo systemctl daemon-reload
echo "✅ systemd已重新加载"
echo ""

echo "正在重启服务..."
sudo systemctl restart legal-service-hub-api
sleep 2
sudo systemctl restart legal-service-hub-worker
sleep 2
sudo systemctl restart legal-service-hub
sleep 3

echo "✅ 所有服务已重启"
echo ""

# 第8步：验证
echo "========================================="
echo "🔍 验证部署"
echo "========================================="
echo ""

echo "1. 检查服务状态..."
sudo systemctl is-active legal-service-hub-api && echo "  ✅ API服务运行中" || echo "  ❌ API服务未运行"
sudo systemctl is-active legal-service-hub-worker && echo "  ✅ Worker服务运行中" || echo "  ❌ Worker服务未运行"
sudo systemctl is-active legal-service-hub && echo "  ✅ 前端服务运行中" || echo "  ❌ 前端服务未运行"
echo ""

echo "2. 检查端口监听..."
netstat -tlnp 2>/dev/null | grep ":189" || echo "  ⚠️  189端口未监听"
echo ""

echo "3. 测试后端健康..."
curl -s http://127.0.0.1:8000/health/live && echo "  ✅ 后端存活" || echo "  ❌ 后端无响应"
echo ""

echo "4. 测试前端访问..."
sleep 2
curl -I http://172.22.3.76:189/ 2>&1 | head -1
echo ""

echo "========================================="
echo "✅ 修复完成！"
echo "========================================="
echo ""
echo "请在浏览器访问: http://172.22.3.76:189/"
echo ""
echo "如遇问题，查看日志:"
echo "  sudo journalctl -u legal-service-hub -n 50"
echo "  sudo journalctl -u legal-service-hub-api -n 50"
echo ""
