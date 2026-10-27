# 预发布环境快速部署指南

## 🎯 部署目标

**访问地址**: `http://172.22.3.76:189/`

**服务架构**:
- 前端: Node.js 静态服务器 (端口 189)
- 后端 API: FastAPI (端口 8000, 仅本地)
- Worker: Python 后台任务处理
- 数据库: SQLite (`backend/data/legal_service.db`)

---

## 🚀 快速部署

### 方法一：使用自动部署脚本（推荐）

```bash
cd /home/lawsft/legal-service-hub

# 给脚本执行权限
chmod +x deploy-staging.sh

# 执行部署
./deploy-staging.sh
```

脚本会自动完成：
1. ✅ 数据库迁移
2. ✅ 停止旧服务
3. ✅ 启动后端 API + Worker
4. ✅ 启动前端服务
5. ✅ 验证部署

---

### 方法二：手动部署步骤

```bash
cd /home/lawsft/legal-service-hub

# 1. 数据库迁移
cd backend
source .venv/bin/activate
alembic upgrade head
cd ..

# 2. 停止现有服务
pkill -f "uvicorn.*app.main:app"
pkill -f "python.*app.worker"
pkill -f "node.*server.mjs.*189"

# 3. 启动后端服务
cd backend
nohup .venv/bin/uvicorn app.main:app \
    --host 127.0.0.1 \
    --port 8000 \
    --workers 4 \
    --proxy-headers \
    --forwarded-allow-ips 127.0.0.1 \
    > logs/api.log 2>&1 &

# 4. 启动 Worker
nohup .venv/bin/python -m app.worker > logs/worker.log 2>&1 &
cd ..

# 5. 启动前端服务
nohup env HOST=172.22.3.76 PORT=189 API_UPSTREAM=http://127.0.0.1:8000 \
    node server.mjs > frontend.log 2>&1 &

# 6. 等待几秒让服务启动
sleep 3
```

---

## ✅ 验证部署

```bash
# 检查服务进程
ps aux | grep -E "(uvicorn|python.*app.worker|node.*server.mjs.*189)" | grep -v grep

# 检查后端健康
curl http://127.0.0.1:8000/health/live
curl http://127.0.0.1:8000/health/ready

# 检查前端
curl -I http://172.22.3.76:189/

# 测试新功能（需要登录后获取 token）
# 在浏览器访问 http://172.22.3.76:189/
```

**预期结果**:
- 3 个进程运行中（uvicorn, worker, node）
- 后端返回 `{"status":"ok"}`
- 前端返回 `HTTP/1.1 200 OK`

---

## 🎨 测试新功能

访问 `http://172.22.3.76:189/` 并测试：

### 1. 咨询分类选择
- [ ] 看到三个分类卡片（民事/刑事/不确定）
- [ ] 点击分类显示对应的 intake 表单
- [ ] 刑事+羁押状态显示高风险警告

### 2. 历史记录增强
- [ ] 点击"咨询记录"按钮
- [ ] 看到分类过滤按钮（全部/民事/刑事/不确定）
- [ ] 每条记录显示彩色分类徽章
- [ ] 高风险咨询显示红色警告徽章
- [ ] 点击过滤按钮筛选不同分类

### 3. 帮助指南
- [ ] 点击"了解咨询方式"
- [ ] 看到三个视觉化分类卡片
- [ ] 看到风险识别说明
- [ ] 刑事类别特别标注紧急性

---

## 📊 监控服务

### 查看日志

```bash
cd /home/lawsft/legal-service-hub

# API 日志
tail -f backend/logs/api.log

# Worker 日志
tail -f backend/logs/worker.log

# 前端日志
tail -f frontend.log

# 所有日志
tail -f backend/logs/*.log frontend.log
```

### 查看进程状态

```bash
# 列出所有相关进程
ps aux | grep -E "(uvicorn|python.*app.worker|node.*server.mjs)" | grep -v grep

# 查看端口占用
netstat -tlnp | grep -E "(8000|189)"
# 或使用 ss
ss -tlnp | grep -E "(8000|189)"
```

### 监控资源使用

```bash
# CPU 和内存使用
top -p $(pgrep -d',' -f 'uvicorn|app.worker|server.mjs')

# 磁盘使用
du -sh backend/data/
du -sh backend/logs/
```

---

## 🛑 停止服务

### 停止所有服务

```bash
# 方法 1: 使用 pkill
pkill -f "uvicorn.*app.main:app"
pkill -f "python.*app.worker"
pkill -f "node.*server.mjs.*189"

# 方法 2: 使用 PID（更精确）
ps aux | grep -E "(uvicorn|python.*app.worker|node.*server.mjs.*189)" | grep -v grep
kill <PID1> <PID2> <PID3>

# 强制停止（如果上面不起作用）
pkill -9 -f "uvicorn.*app.main:app"
pkill -9 -f "python.*app.worker"
pkill -9 -f "node.*server.mjs.*189"
```

### 只重启某个服务

```bash
# 重启 API
pkill -f "uvicorn.*app.main:app"
cd /home/lawsft/legal-service-hub/backend
nohup .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 4 > logs/api.log 2>&1 &

# 重启前端
pkill -f "node.*server.mjs.*189"
cd /home/lawsft/legal-service-hub
nohup env HOST=172.22.3.76 PORT=189 node server.mjs > frontend.log 2>&1 &
```

---

## ⚠️ 常见问题

### 问题 1: 端口已被占用

```bash
# 查找占用端口的进程
lsof -i :8000
lsof -i :189

# 或使用 ss
ss -tlnp | grep 8000
ss -tlnp | grep 189

# 停止占用进程
kill <PID>
```

### 问题 2: 前端无法访问

```bash
# 检查前端进程
ps aux | grep "node.*server.mjs.*189"

# 检查监听地址
netstat -tlnp | grep 189

# 查看前端日志
tail -30 frontend.log

# 确认防火墙没有阻止
sudo iptables -L | grep 189
```

### 问题 3: API 502 错误

这通常表示前端可以访问，但后端 API 不可用：

```bash
# 检查后端是否运行
curl http://127.0.0.1:8000/health/live

# 查看 API 日志
tail -50 backend/logs/api.log

# 检查数据库
ls -lh backend/data/legal_service.db

# 测试数据库连接
cd backend
source .venv/bin/activate
python -c "from app.core.database import engine; print(engine.url)"
```

### 问题 4: 数据库迁移失败

```bash
cd /home/lawsft/legal-service-hub/backend
source .venv/bin/activate

# 查看迁移历史
alembic history

# 查看当前版本
alembic current

# 回滚一个版本
alembic downgrade -1

# 重新升级
alembic upgrade head

# 如果完全损坏，重置数据库（⚠️ 会丢失数据）
rm data/legal_service.db
alembic upgrade head
python scripts/manage.py seed-demo
```

### 问题 5: 分类过滤不工作

```bash
# 检查 API 代码是否包含过滤逻辑
grep -A 5 "category: str | None" backend/app/api/consultations.py

# 如果没有，说明代码未更新
cd /home/lawsft/legal-service-hub
git status
git pull  # 如果有远程更新

# 重启服务
./deploy-staging.sh
```

---

## 🔄 回滚部署

如果新版本有问题，快速回滚：

```bash
cd /home/lawsft/legal-service-hub

# 1. 停止服务
pkill -f "uvicorn.*app.main:app"
pkill -f "python.*app.worker"
pkill -f "node.*server.mjs.*189"

# 2. 回滚代码
git log --oneline -5
git reset --hard <previous-commit-hash>

# 3. 回滚数据库
cd backend
source .venv/bin/activate
alembic downgrade -1

# 4. 重新部署
cd ..
./deploy-staging.sh
```

---

## 📝 部署检查清单

部署后验证以下项目：

- [ ] 3 个进程正常运行
- [ ] 前端可访问 `http://172.22.3.76:189/`
- [ ] API 健康检查通过
- [ ] 可以登录
- [ ] 可以创建新咨询
- [ ] 看到分类选择界面
- [ ] 历史记录显示分类徽章
- [ ] 过滤按钮工作正常
- [ ] 帮助指南内容更新
- [ ] 日志没有异常错误

---

## 🆘 紧急联系

**日志位置**:
- API: `backend/logs/api.log`
- Worker: `backend/logs/worker.log`
- Frontend: `frontend.log`

**数据库位置**:
- `backend/data/legal_service.db`

**配置文件**:
- `backend/.env`

**部署文档**:
- `DEPLOYMENT_GUIDE.md` - 详细部署指南
- `CONSULTATION_ENHANCEMENTS.md` - 功能详情
- `CONSULTATION_ARCHITECTURE.md` - 系统架构

---

## 快速命令参考

```bash
# === 部署 ===
./deploy-staging.sh                                    # 自动部署

# === 服务控制 ===
pkill -f "uvicorn|app.worker|server.mjs.*189"         # 停止所有
ps aux | grep -E "uvicorn|worker|server.mjs" | grep -v grep  # 查看进程

# === 健康检查 ===
curl http://127.0.0.1:8000/health/live                # 后端存活
curl http://127.0.0.1:8000/health/ready               # 后端就绪
curl -I http://172.22.3.76:189/                       # 前端状态

# === 日志 ===
tail -f backend/logs/api.log                          # API 日志
tail -f backend/logs/worker.log                       # Worker 日志
tail -f frontend.log                                  # 前端日志

# === 数据库 ===
cd backend && source .venv/bin/activate
alembic current                                       # 当前版本
alembic upgrade head                                  # 升级
alembic downgrade -1                                  # 降级
```

---

**部署时间**: ~3-5 分钟  
**停机时间**: ~5-10 秒（服务重启期间）

祝部署顺利！🚀
