# 🚀 部署说明 - 预发布环境

## 访问地址
**http://172.22.3.76:189/**

---

## 快速开始

### 第一次部署（包含数据库迁移）

```bash
cd /home/lawsft/legal-service-hub
chmod +x deploy-staging.sh
./deploy-staging.sh
```

### 日常更新（代码更新后重启服务）

```bash
cd /home/lawsft/legal-service-hub
chmod +x restart.sh
./restart.sh
```

---

## 部署脚本说明

### 1. `deploy-staging.sh` - 完整部署
- ✅ 运行数据库迁移
- ✅ 停止旧服务
- ✅ 启动后端 API (端口 8000)
- ✅ 启动 Worker
- ✅ 启动前端 (端口 189)
- ✅ 验证服务健康

**使用场景**: 
- 第一次部署
- 有数据库结构变更
- 完整重新部署

---

### 2. `restart.sh` - 快速重启
- 🛑 停止现有服务
- 🚀 重启所有服务
- ✅ 显示运行状态

**使用场景**:
- 代码更新
- 配置修改
- 日常重启

---

## 手动操作

### 停止服务
```bash
pkill -f "uvicorn.*app.main:app"
pkill -f "python.*app.worker"
pkill -f "node.*server.mjs.*189"
```

### 查看运行状态
```bash
ps aux | grep -E "(uvicorn|python.*app.worker|node.*server.mjs.*189)" | grep -v grep
```

### 查看日志
```bash
tail -f backend/logs/api.log      # API 日志
tail -f backend/logs/worker.log   # Worker 日志
tail -f frontend.log              # 前端日志
```

### 健康检查
```bash
curl http://127.0.0.1:8000/health/live    # 后端存活
curl http://172.22.3.76:189/              # 前端访问
```

---

## 本次部署内容

### 新功能
✅ **咨询分类系统**
- 民事/刑事/不确定 三种分类
- 分类专属 intake 表单
- 自动风险评估

✅ **历史记录增强**
- 分类过滤按钮
- 彩色分类徽章
- 高风险警告标识

✅ **帮助指南扩展**
- 详细分类说明
- 视觉化卡片
- 风险识别指导

### 技术变更
- 后端: API 过滤功能 (+12 行)
- 前端: UI 增强 (+35 行)
- 样式: CSS 组件 (+160 行)
- 测试: 过滤验证 (+10 行)
- 数据库: category, intake_json 字段

---

## 详细文档

1. **DEPLOY_STAGING.md** - 详细部署指南
   - 手动部署步骤
   - 问题排查
   - 监控方法
   - 回滚步骤

2. **DEPLOYMENT_GUIDE.md** - 通用部署文档
   - 开发/生产环境
   - systemd 配置
   - 完整部署流程

3. **CONSULTATION_ENHANCEMENTS.md** - 功能详情
   - 实现说明
   - API 文档
   - 用户体验改进

4. **CONSULTATION_ARCHITECTURE.md** - 系统架构
   - 数据流图
   - 组件关系
   - 技术栈

---

## 验证清单

部署后请验证：

- [ ] 访问 http://172.22.3.76:189/ 正常
- [ ] 可以登录
- [ ] 看到三个分类选择卡片
- [ ] 历史记录显示分类徽章
- [ ] 过滤按钮工作
- [ ] 帮助指南内容更新
- [ ] API 健康检查通过
- [ ] 日志无严重错误

---

## 紧急情况

### 服务无法启动
1. 查看日志: `tail -50 backend/logs/api.log`
2. 检查端口: `lsof -i :8000` 和 `lsof -i :189`
3. 检查数据库: `ls -lh backend/data/legal_service.db`

### 快速回滚
```bash
cd /home/lawsft/legal-service-hub
git reset --hard HEAD~1
cd backend && source .venv/bin/activate
alembic downgrade -1
cd .. && ./restart.sh
```

---

## 支持

**日志位置**:
- `backend/logs/api.log`
- `backend/logs/worker.log`
- `frontend.log`

**配置文件**:
- `backend/.env`

**数据库**:
- `backend/data/legal_service.db`

---

**准备好了吗？执行部署:**

```bash
cd /home/lawsft/legal-service-hub
./deploy-staging.sh
```

🎉 部署完成后访问: **http://172.22.3.76:189/**
