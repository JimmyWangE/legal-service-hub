#!/bin/bash
# 法律服务平台部署脚本
# 用途：运行数据库迁移、构建前端、重启服务

set -e  # 遇到错误立即退出

echo "=========================================="
echo "法律服务平台 - 部署脚本"
echo "=========================================="

# 项目根目录
PROJECT_DIR="/home/lawsft/legal-service-hub"
cd "$PROJECT_DIR"

echo ""
echo "[1/5] 检查环境..."
# 检查 Python 虚拟环境
if [ ! -d "backend/.venv" ]; then
    echo "❌ Python 虚拟环境不存在，请先运行: python3 -m venv backend/.venv"
    exit 1
fi

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js 未安装"
    exit 1
fi

echo "✅ 环境检查通过"

echo ""
echo "[2/5] 运行数据库迁移..."
cd backend
source .venv/bin/activate

# 检查当前迁移状态
echo "当前迁移状态:"
alembic current

# 运行迁移
echo "执行迁移到最新版本..."
alembic upgrade head

echo "✅ 数据库迁移完成"
echo "迁移后状态:"
alembic current

cd ..

echo ""
echo "[3/5] 构建前端资源..."
# 构建前端到 /var/www/legal-service-hub
BUILD_TARGET="/var/www/legal-service-hub"

if [ -w "$BUILD_TARGET" ] || [ -w "$(dirname "$BUILD_TARGET")" ]; then
    echo "构建到: $BUILD_TARGET"
    npm run build -- "$BUILD_TARGET"
    echo "✅ 前端资源构建完成"
else
    echo "⚠️  无写入权限到 $BUILD_TARGET"
    echo "   如需部署到生产目录，请使用 sudo 运行此脚本"
    echo "   或手动运行: sudo npm run build -- $BUILD_TARGET"
fi

echo ""
echo "[4/5] 重启后端服务..."

# 检查是否有 systemd 服务
if systemctl list-units --full -all | grep -q "legal-service-hub-api.service"; then
    echo "重启服务: legal-service-hub-api, legal-service-hub-worker, legal-service-hub"

    if [ "$EUID" -eq 0 ]; then
        systemctl restart legal-service-hub-api legal-service-hub-worker legal-service-hub
        echo "✅ 服务重启完成"
    else
        echo "⚠️  需要 sudo 权限重启服务"
        echo "   请手动运行: sudo systemctl restart legal-service-hub-api legal-service-hub-worker legal-service-hub"
    fi
else
    echo "⚠️  未找到 systemd 服务"
    echo "   开发环境请手动重启服务"

    # 检查是否有运行中的 uvicorn 进程
    if pgrep -f "uvicorn.*app.main:app" > /dev/null; then
        echo ""
        echo "   当前运行的后端进程:"
        ps aux | grep -E "(uvicorn|python.*app)" | grep -v grep
        echo ""
        echo "   提示: 手动重启后端服务"
    fi
fi

echo ""
echo "[5/5] 验证部署..."

# 检查后端健康状态
echo "检查后端健康状态..."
if curl -s http://127.0.0.1:8000/health/live > /dev/null 2>&1; then
    echo "✅ 后端服务运行正常 (http://127.0.0.1:8000)"

    # 检查就绪状态
    READY_STATUS=$(curl -s http://127.0.0.1:8000/health/ready)
    echo "就绪检查: $READY_STATUS"

    # 检查能力
    echo ""
    echo "平台能力:"
    curl -s http://127.0.0.1:8000/api/v1/capabilities | python3 -m json.tool 2>/dev/null || echo "无法获取能力信息"
else
    echo "⚠️  后端服务可能未运行"
    echo "   请检查服务状态: systemctl status legal-service-hub-api"
fi

# 检查前端服务
echo ""
echo "检查前端服务..."
if pgrep -f "node.*server.mjs" > /dev/null; then
    echo "✅ 前端服务运行中"
elif systemctl is-active --quiet legal-service-hub 2>/dev/null; then
    echo "✅ 前端服务运行中 (systemd)"
else
    echo "⚠️  前端服务可能未运行"
    echo "   开发环境启动: npm start"
    echo "   生产环境检查: systemctl status legal-service-hub"
fi

echo ""
echo "=========================================="
echo "✅ 部署完成"
echo "=========================================="
echo ""
echo "本次部署包含以下增强:"
echo "  • 咨询分类过滤 (category & risk_level 参数)"
echo "  • 历史记录分类徽章与过滤按钮"
echo "  • 增强的帮助指南"
echo "  • 新增 CSS 样式 (160+ 行)"
echo ""
echo "访问地址:"
echo "  • 开发环境: http://127.0.0.1:4173/"
echo "  • 预发布环境: http://172.22.3.76:189/"
echo "  • API 文档: http://127.0.0.1:8000/docs"
echo ""
echo "监控命令:"
echo "  systemctl status legal-service-hub-api"
echo "  journalctl -u legal-service-hub-api -f"
echo "  curl http://127.0.0.1:8000/health/ready"
echo ""
