#!/bin/bash
# 法律服务平台 - 预发布环境部署脚本
# 部署地址: http://172.22.3.76:189/

set -e

echo "=========================================="
echo "法律服务平台 - 预发布环境部署"
echo "目标: http://172.22.3.76:189/"
echo "=========================================="

PROJECT_DIR="/home/lawsft/legal-service-hub"
cd "$PROJECT_DIR"

# 检查当前用户
CURRENT_USER=$(whoami)
echo "当前用户: $CURRENT_USER"

echo ""
echo "[1/6] 检查环境..."
if [ ! -d "backend/.venv" ]; then
    echo "❌ Python 虚拟环境不存在"
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo "❌ Node.js 未安装"
    exit 1
fi

echo "✅ 环境检查通过"

echo ""
echo "[2/6] 运行数据库迁移..."
cd backend
source .venv/bin/activate

echo "当前迁移状态:"
alembic current || echo "首次运行迁移"

echo "执行迁移..."
alembic upgrade head

echo "✅ 数据库迁移完成"
alembic current

cd ..

echo ""
echo "[3/6] 停止现有服务..."

# 查找并停止前端服务
FRONTEND_PID=$(pgrep -f "node.*server.mjs.*189" || true)
if [ -n "$FRONTEND_PID" ]; then
    echo "停止前端服务 (PID: $FRONTEND_PID)"
    kill $FRONTEND_PID
    sleep 2
else
    echo "前端服务未运行"
fi

# 查找并停止后端服务
BACKEND_PID=$(pgrep -f "uvicorn.*app.main:app.*8000" || true)
if [ -n "$BACKEND_PID" ]; then
    echo "停止后端服务 (PID: $BACKEND_PID)"
    kill $BACKEND_PID
    sleep 2
else
    echo "后端服务未运行"
fi

# 查找并停止 worker
WORKER_PID=$(pgrep -f "python.*app.worker" || true)
if [ -n "$WORKER_PID" ]; then
    echo "停止 worker (PID: $WORKER_PID)"
    kill $WORKER_PID
    sleep 1
else
    echo "Worker 未运行"
fi

echo "✅ 服务已停止"

echo ""
echo "[4/6] 启动后端服务..."
cd backend
source .venv/bin/activate

# 启动 API 服务（后台运行，输出到日志）
echo "启动 API 服务在端口 8000..."
nohup .venv/bin/uvicorn app.main:app \
    --host 127.0.0.1 \
    --port 8000 \
    --workers 4 \
    --proxy-headers \
    --forwarded-allow-ips 127.0.0.1 \
    > logs/api.log 2>&1 &

API_PID=$!
echo "API 服务已启动 (PID: $API_PID)"

# 启动 Worker
echo "启动 Worker..."
nohup .venv/bin/python -m app.worker > logs/worker.log 2>&1 &
WORKER_PID=$!
echo "Worker 已启动 (PID: $WORKER_PID)"

# 等待后端启动
echo "等待后端服务就绪..."
for i in {1..30}; do
    if curl -s http://127.0.0.1:8000/health/live > /dev/null 2>&1; then
        echo "✅ 后端服务已就绪"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ 后端服务启动超时"
        tail -20 logs/api.log
        exit 1
    fi
    sleep 1
done

cd ..

echo ""
echo "[5/6] 启动前端服务..."

# 启动前端服务在 189 端口
echo "启动前端服务在 http://172.22.3.76:189/ ..."
nohup env HOST=172.22.3.76 PORT=189 API_UPSTREAM=http://127.0.0.1:8000 \
    node server.mjs > frontend.log 2>&1 &

FRONTEND_PID=$!
echo "前端服务已启动 (PID: $FRONTEND_PID)"

# 等待前端启动
echo "等待前端服务就绪..."
for i in {1..10}; do
    if curl -s http://172.22.3.76:189/ > /dev/null 2>&1; then
        echo "✅ 前端服务已就绪"
        break
    fi
    if [ $i -eq 10 ]; then
        echo "⚠️  前端服务启动可能有问题，请检查日志"
        tail -10 frontend.log
    fi
    sleep 1
done

echo ""
echo "[6/6] 验证部署..."

# 检查后端健康
echo "检查后端健康状态..."
HEALTH_RESPONSE=$(curl -s http://127.0.0.1:8000/health/live)
echo "Live check: $HEALTH_RESPONSE"

READY_RESPONSE=$(curl -s http://127.0.0.1:8000/health/ready)
echo "Ready check: $READY_RESPONSE"

# 检查前端
echo ""
echo "检查前端服务..."
if curl -s -o /dev/null -w "%{http_code}" http://172.22.3.76:189/ | grep -q "200"; then
    echo "✅ 前端服务响应正常"
else
    echo "⚠️  前端服务响应异常"
fi

# 显示进程信息
echo ""
echo "运行中的服务:"
ps aux | grep -E "(uvicorn|python.*app.worker|node.*server.mjs.*189)" | grep -v grep

echo ""
echo "=========================================="
echo "✅ 部署完成"
echo "=========================================="
echo ""
echo "服务信息:"
echo "  • 前端地址: http://172.22.3.76:189/"
echo "  • API 文档: http://127.0.0.1:8000/docs"
echo "  • API 端口: 8000 (本地)"
echo "  • 前端端口: 189 (对外)"
echo ""
echo "进程 ID:"
echo "  • API: $API_PID"
echo "  • Worker: $WORKER_PID"
echo "  • Frontend: $FRONTEND_PID"
echo ""
echo "日志文件:"
echo "  • API: backend/logs/api.log"
echo "  • Worker: backend/logs/worker.log"
echo "  • Frontend: frontend.log"
echo ""
echo "本次部署包含以下增强:"
echo "  ✅ 咨询分类过滤 API (category & risk_level)"
echo "  ✅ 历史记录分类徽章与过滤按钮"
echo "  ✅ 增强的帮助指南"
echo "  ✅ 专业 CSS 样式 (160+ 行)"
echo ""
echo "监控命令:"
echo "  tail -f backend/logs/api.log      # API 日志"
echo "  tail -f backend/logs/worker.log   # Worker 日志"
echo "  tail -f frontend.log              # 前端日志"
echo "  ps aux | grep 'uvicorn\\|worker\\|server.mjs' | grep -v grep"
echo ""
echo "停止服务:"
echo "  kill $API_PID $WORKER_PID $FRONTEND_PID"
echo ""
