# 部署指南 - 咨询分类增强功能

## 概述

本次部署包含以下新功能：
- ✅ API 咨询分类过滤 (category & risk_level)
- ✅ 历史记录界面增强 (分类徽章 + 过滤按钮)
- ✅ 帮助指南扩展 (详细分类说明)
- ✅ CSS 样式更新 (160+ 行新样式)

**文件变更**:
- `backend/app/api/consultations.py` - API 过滤逻辑
- `model-consultation.js` - 前端增强
- `model-consultation.css` - 样式更新
- `backend/tests/test_business_flow.py` - 测试增强

---

## 快速部署 (推荐)

### 方式一：使用部署脚本

```bash
cd /home/lawsft/legal-service-hub
./deploy.sh
```

**注意**: 如需部署到生产目录或重启 systemd 服务，需要 sudo 权限：
```bash
sudo ./deploy.sh
```

---

### 方式二：手动部署步骤

## 步骤 1: 数据库迁移

```bash
cd /home/lawsft/legal-service-hub/backend
source .venv/bin/activate

# 查看当前迁移状态
alembic current

# 执行迁移
alembic upgrade head

# 确认迁移成功
alembic current
```

**预期输出**:
```
INFO  [alembic.runtime.migration] Running upgrade  -> 20261021_06_business_flow
```

**验证**:
```bash
# 检查 category 和 intake_json 列是否存在
sqlite3 backend/app.db ".schema consultations"
# 或者 PostgreSQL:
# psql -d legal_service_hub -c "\d consultations"
```

---

## 步骤 2: 构建前端资源

```bash
cd /home/lawsft/legal-service-hub

# 开发环境 (无需构建)
# 前端使用 ES modules，直接重启服务即可

# 生产环境 (构建到静态目录)
npm run build -- /var/www/legal-service-hub
```

**如果没有 sudo 权限**:
```bash
# 先构建到临时目录
npm run build -- ./dist

# 然后请管理员复制
sudo cp -r ./dist/* /var/www/legal-service-hub/
```

---

## 步骤 3: 重启后端服务

### 生产环境 (systemd)

```bash
# 重启所有相关服务
sudo systemctl restart legal-service-hub-api
sudo systemctl restart legal-service-hub-worker
sudo systemctl restart legal-service-hub

# 检查服务状态
sudo systemctl status legal-service-hub-api
sudo systemctl status legal-service-hub-worker
sudo systemctl status legal-service-hub
```

### 开发环境 (手动)

```bash
# 查找运行中的进程
ps aux | grep -E "(uvicorn|python.*app)" | grep -v grep

# 方法 1: 使用 pkill (推荐)
pkill -f "uvicorn.*app.main:app"
pkill -f "python.*app.worker"

# 方法 2: 使用 PID (更精确)
kill <PID>

# 重新启动后端
cd /home/lawsft/legal-service-hub/backend
PYTHONPATH=backend .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload &

# 启动 worker
.venv/bin/python -m app.worker &
```

---

## 步骤 4: 重启前端服务

### 生产环境

```bash
sudo systemctl restart legal-service-hub
sudo systemctl status legal-service-hub
```

### 开发环境

```bash
# 查找前端进程
ps aux | grep "node.*server.mjs" | grep -v grep

# 停止
pkill -f "node.*server.mjs"

# 重启
cd /home/lawsft/legal-service-hub
npm start &
```

---

## 步骤 5: 验证部署

### 5.1 检查后端健康状态

```bash
# 存活检查
curl http://127.0.0.1:8000/health/live

# 就绪检查 (包含依赖服务)
curl http://127.0.0.1:8000/health/ready

# 平台能力
curl http://127.0.0.1:8000/api/v1/capabilities | python3 -m json.tool
```

**预期输出**:
```json
{
  "payment": {
    "provider": "stub",
    "enabled": true
  },
  "model": {
    "provider": "openai_compatible",
    "available": true
  },
  "registration": {
    "security_mode": "arithmetic_challenge"
  }
}
```

### 5.2 测试新 API 端点

```bash
# 需要先登录获取 token
TOKEN="your-jwt-token"

# 测试分类过滤
curl -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8000/api/v1/consultations?category=civil"

curl -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8000/api/v1/consultations?risk_level=high"

# 组合过滤
curl -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8000/api/v1/consultations?category=criminal&risk_level=high"
```

### 5.3 验证前端功能

访问应用并测试：

1. **创建咨询** - `http://127.0.0.1:4173/` (开发) 或 `http://172.22.3.76:189/` (预发布)
   - [ ] 看到三个分类选择卡片
   - [ ] 选择分类后显示对应的intake表单
   - [ ] 刑事+羁押状态显示高风险警告

2. **历史记录**
   - [ ] 点击"咨询记录"按钮打开历史
   - [ ] 看到分类过滤按钮 (全部/民事/刑事/不确定)
   - [ ] 每条记录显示分类徽章
   - [ ] 高风险咨询显示红色风险徽章
   - [ ] 点击过滤按钮筛选对应分类

3. **帮助指南**
   - [ ] 点击"了解咨询方式"按钮
   - [ ] 看到三个视觉化的分类说明卡片
   - [ ] 看到"风险识别"部分
   - [ ] 刑事分类特别强调紧急性

### 5.4 运行自动化测试

```bash
cd /home/lawsft/legal-service-hub/backend

# 运行业务流程测试
.venv/bin/pytest tests/test_business_flow.py::test_consultation_category_intake_and_sticky_risk -v

# 运行所有测试
.venv/bin/pytest tests/ -v
```

**预期输出**:
```
tests/test_business_flow.py::test_consultation_category_intake_and_sticky_risk PASSED
```

---

## 步骤 6: 监控与日志

### 查看服务日志

```bash
# API 服务日志
sudo journalctl -u legal-service-hub-api -f

# Worker 日志
sudo journalctl -u legal-service-hub-worker -f

# 前端服务日志
sudo journalctl -u legal-service-hub -f

# 所有服务
sudo journalctl -u legal-service-hub* -f
```

### 检查错误

```bash
# 最近的错误
sudo journalctl -u legal-service-hub-api --since "5 minutes ago" -p err

# 特定时间范围
sudo journalctl -u legal-service-hub-api --since "2026-10-21 14:00" --until "2026-10-21 15:00"
```

---

## 常见问题排查

### 问题 1: 数据库迁移失败

**症状**: `alembic upgrade head` 报错

**解决**:
```bash
# 查看迁移历史
alembic history

# 回滚到上一个版本
alembic downgrade -1

# 重新升级
alembic upgrade head

# 如果仍失败，检查数据库连接
cd backend
source .venv/bin/activate
python -c "from app.core.database import engine; print(engine.url)"
```

### 问题 2: 后端服务启动失败

**症状**: `systemctl status` 显示 failed

**排查**:
```bash
# 查看详细错误
sudo journalctl -u legal-service-hub-api -n 50

# 检查配置文件
cat backend/.env

# 手动启动看错误
cd backend
source .venv/bin/activate
PYTHONPATH=backend .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

**常见原因**:
- 端口被占用 → `lsof -i :8000`
- 数据库连接失败 → 检查 DATABASE_URL
- 模型服务不可达 → 检查 MODEL_BASE_URL
- 依赖缺失 → `pip install -r requirements.txt`

### 问题 3: 前端资源未更新

**症状**: 浏览器看不到新功能

**解决**:
```bash
# 清除浏览器缓存 (Ctrl+Shift+R 硬刷新)

# 检查静态资源是否更新
ls -lh /var/www/legal-service-hub/model-consultation.js
ls -lh /var/www/legal-service-hub/model-consultation.css

# 如果文件没更新，重新构建
npm run build -- /var/www/legal-service-hub
sudo systemctl restart legal-service-hub

# 开发环境直接重启
pkill -f "node.*server.mjs"
npm start
```

### 问题 4: API 过滤不生效

**症状**: 过滤参数无效，返回所有咨询

**排查**:
```bash
# 检查 API 代码是否部署
grep -A 5 "category: str | None" backend/app/api/consultations.py

# 测试端点
curl -v "http://127.0.0.1:8000/api/v1/consultations?category=civil"

# 如果返回 422 错误，检查参数拼写
# 正确: category=civil, risk_level=high
# 错误: type=civil, risk=high
```

### 问题 5: 前端过滤按钮不工作

**症状**: 点击过滤按钮无反应

**排查**:
1. 打开浏览器开发者工具 (F12)
2. 查看 Console 是否有 JavaScript 错误
3. 检查 Network 标签是否有 JS 文件 404

**解决**:
```bash
# 确认文件已更新
grep "model-filter-btn" model-consultation.js
grep "category-badge" model-consultation.css

# 检查文件大小
ls -lh model-consultation.js model-consultation.css

# 重新部署前端
npm start  # 开发环境
# 或
sudo npm run build -- /var/www/legal-service-hub  # 生产环境
```

---

## 回滚步骤

如果部署出现严重问题，按以下步骤回滚：

### 1. 回滚代码

```bash
cd /home/lawsft/legal-service-hub
git status
git log --oneline -5

# 回滚到上一个 commit
git reset --hard HEAD~1

# 或回滚到特定 commit
git reset --hard <commit-hash>
```

### 2. 回滚数据库

```bash
cd backend
source .venv/bin/activate

# 查看当前版本
alembic current

# 降级到上一个版本
alembic downgrade -1

# 或降级到特定版本
alembic downgrade <revision-id>
```

### 3. 重启服务

```bash
sudo systemctl restart legal-service-hub-api
sudo systemctl restart legal-service-hub-worker
sudo systemctl restart legal-service-hub
```

---

## 部署后检查清单

- [ ] 数据库迁移成功 (`alembic current` 显示最新版本)
- [ ] 后端服务运行正常 (`systemctl status legal-service-hub-api`)
- [ ] Worker 运行正常 (`systemctl status legal-service-hub-worker`)
- [ ] 前端服务运行正常 (`systemctl status legal-service-hub`)
- [ ] 健康检查通过 (`curl http://127.0.0.1:8000/health/ready`)
- [ ] API 文档可访问 (`http://127.0.0.1:8000/docs`)
- [ ] 前端页面可访问
- [ ] 分类选择功能正常
- [ ] 历史过滤功能正常
- [ ] 帮助指南显示正确
- [ ] 分类徽章显示正确
- [ ] API 过滤端点工作
- [ ] 自动化测试通过

---

## 性能监控

部署后前 24-48 小时建议监控以下指标：

### API 响应时间
```bash
# 监控慢查询
grep "GET /api/v1/consultations" /var/log/legal-service-hub/access.log | \
  awk '{print $NF}' | sort -n | tail -20
```

### 错误率
```bash
# 统计 HTTP 错误
grep "500\|502\|503\|504" /var/log/legal-service-hub/access.log | wc -l

# 后端异常
sudo journalctl -u legal-service-hub-api --since today | grep -i "error\|exception" | wc -l
```

### 数据库连接
```bash
# PostgreSQL 连接数
psql -d legal_service_hub -c "SELECT count(*) FROM pg_stat_activity;"

# SQLite 锁情况 (如果使用 SQLite)
# 观察是否有 "database is locked" 错误
```

---

## 联系与支持

**部署问题**: 查看 `/home/lawsft/legal-service-hub/backend/logs/`

**功能问题**: 参考文档
- `CONSULTATION_CATEGORY_FLOW.md` - 核心实现
- `CONSULTATION_ENHANCEMENTS.md` - 增强功能详情
- `CONSULTATION_SUMMARY.md` - 项目总结
- `CONSULTATION_ARCHITECTURE.md` - 架构图

**测试**: `backend/tests/test_business_flow.py`

---

## 附录：快速命令参考

```bash
# === 部署 ===
./deploy.sh                                              # 自动部署
sudo systemctl restart legal-service-hub*                # 重启所有服务

# === 健康检查 ===
curl http://127.0.0.1:8000/health/live                   # 存活
curl http://127.0.0.1:8000/health/ready                  # 就绪
curl http://127.0.0.1:8000/api/v1/capabilities           # 能力

# === 日志 ===
sudo journalctl -u legal-service-hub-api -f              # API 日志
sudo journalctl -u legal-service-hub* -f                 # 所有服务日志

# === 测试 ===
cd backend && .venv/bin/pytest tests/test_business_flow.py -v

# === 数据库 ===
cd backend && source .venv/bin/activate
alembic current                                          # 当前版本
alembic upgrade head                                     # 升级
alembic downgrade -1                                     # 降级

# === 服务状态 ===
systemctl status legal-service-hub-api                   # API 状态
systemctl status legal-service-hub-worker                # Worker 状态
systemctl status legal-service-hub                       # 前端状态
```

---

**部署时间**: 约 5-10 分钟  
**预计停机时间**: < 30 秒 (仅重启服务期间)  
**回滚时间**: < 2 分钟

祝部署顺利！🚀
