#!/bin/bash
# 一键重启服务（用于代码更新后快速重启）

cd /home/lawsft/legal-service-hub

echo "🛑 停止服务..."
pkill -f "uvicorn.*app.main:app" 2>/dev/null
pkill -f "python.*app.worker" 2>/dev/null
pkill -f "node.*server.mjs.*189" 2>/dev/null
sleep 2

echo "🚀 启动后端..."
cd backend
source .venv/bin/activate
nohup .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 4 > logs/api.log 2>&1 &
nohup .venv/bin/python -m app.worker > logs/worker.log 2>&1 &
cd ..
sleep 2

echo "🌐 启动前端..."
nohup env HOST=172.22.3.76 PORT=189 API_UPSTREAM=http://127.0.0.1:8000 node server.mjs > frontend.log 2>&1 &
sleep 1

echo "✅ 服务已启动"
echo "前端: http://172.22.3.76:189/"
echo ""
echo "运行中的进程:"
ps aux | grep -E "(uvicorn|python.*app.worker|node.*server.mjs.*189)" | grep -v grep
