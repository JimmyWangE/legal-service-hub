# 法律服务平台

法律服务平台是一套“法律模型咨询 → 服务需求 → 律师报价 → 订单履约 → 文书协作 → 售后”的全链路系统。前端使用原生 HTML、CSS 和 ES modules；后端使用 Python、FastAPI、SQLAlchemy、PostgreSQL/SQLite 和 Redis；同源 Node 服务负责静态资源发布与 API 反向代理。

## 当前能力

- **账户与权限**：登录、注册、服务端 JWT 会话、密码修改、客户端/律师/运营角色隔离。
- **注册安全校验**：注册使用服务端一次性算术问答，不依赖 SMTP 邮箱验证码；题目有效期 5 分钟且只能使用一次。
- **法律模型咨询**：领域选择、结构化提问模板、连续追问、流式输出、历史记录、复制/导出和反馈；回答由 OpenAI 兼容接口或 vLLM 服务生成。
- **咨询转需求**：用户授权后，后端根据咨询记录生成可编辑的需求草稿，自动提取标题、业务类型、专业领域、服务类型、地区、预算、事实与目标、交付物要求等字段。
- **律师入驻**：律师提交资质和执业材料；运营管理员审核同意后即可完成入驻并启用接单能力，系统仍校验账户状态、申请有效期和重复执业证号。
- **需求与报价**：需求发布、律师筛选、律师报价、接受报价和幂等创建订单。
- **订单履约**：支付、服务中、交付、确认收悉、退款和争议处理等状态流转，关键状态写入审计和事件记录。
- **内网模拟支付**：非生产环境可生成包含订单金额的二维码，用户点击“已支付”即可完成模拟支付；不访问微信/支付宝、不产生真实资金。
- **文书协作**：版本、恢复新版本、批注、访问授权、顺序会签、退回、交付和受控下载。
- **运营后台**：律师审核、律师冻结、售后处理、支付运维和审计日志。
- **运行保障**：数据库、Redis、文件存储和模型服务就绪检查；模型并发限制、请求限流、支付幂等和回调防重放。

## 项目结构

```text
.
├── app.js                         # 前端路由、页面和交互
├── model-consultation.js          # 法律模型咨询 UI 与流式展示
├── api-client.js                  # 同源 API、SSE 和幂等请求客户端
├── server.mjs                     # 静态服务器与 /api/v1 反向代理
├── assets/                        # 前端图标与静态资源
├── scripts/build-static.mjs       # 静态资源发布脚本
├── backend/app/api/               # FastAPI 接口层
├── backend/app/services/          # 业务逻辑与外部服务适配层
├── backend/app/core/              # 配置、鉴权、数据库、限流和支付安全
├── backend/migrations/            # Alembic 数据库迁移
├── backend/scripts/               # 部署、运维和真实模型验收脚本
├── backend/tests/                 # 后端 API、端到端和运维测试
└── *.md                           # 需求、架构、部署和验收文档
```

## 本地启动

### 前端

要求 Node.js 20 或更高版本：

```bash
npm start
```

默认访问 `http://127.0.0.1:4173/`。需要对外监听时：

```bash
HOST=0.0.0.0 PORT=4173 npm start
```

前端服务默认代理 `http://127.0.0.1:8000` 的 `/api/v1/*` 请求。生产或预发布环境应使用 HTTPS 反向代理，不要直接暴露开发端口。

### Python 后端

```bash
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
cp backend/.env.example backend/.env
PYTHONPATH=backend backend/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

API 文档地址为 `http://127.0.0.1:8000/docs`。开发环境默认使用受控 SQLite；预发布和生产应使用 PostgreSQL、Redis、Alembic 迁移及独立 Worker。后端详细说明见 [`backend/README.md`](./backend/README.md)。

## 模型接入

系统通过 OpenAI 兼容协议调用模型。将模型 API Key 保存为独立文件，不要写入仓库、日志或响应：

```dotenv
MODEL_PROVIDER=openai_compatible
MODEL_BASE_URL=http://模型服务地址:180/v1
MODEL_API_KEY_FILE=/etc/legal-service-hub/secrets/model-api-key
MODEL_NAME=模型名称
MODEL_FALLBACK_TO_STUB=false
```

模型请求支持流式传输；模型服务不可用时返回 `model_unavailable`，不会伪造模型回答。生产环境应通过文件权限将 Key 只读授权给 `legal-api` 用户。

## 内网模拟支付

没有真实支付商户配置时，在非生产环境使用以下配置：

```dotenv
APP_ENV=staging
PAYMENT_PROVIDER=stub
PAYMENT_STUB_ENABLED=true
PAYMENT_STUB_SECRET=至少32位随机字符串
```

用户创建支付单后，订单页展示应付金额和二维码；点击“已支付”会调用服务端模拟确认接口，按真实支付相同的账务、通知、审计和订单状态流程落库。模拟支付只用于内网开发和验收，生产环境必须保持 `PAYMENT_PROVIDER=disabled`，或在完成真实商户签约、回调验签、HTTPS 和联调后切换到真实渠道。

## 预发布服务

当前服务器部署约定如下：

| 服务 | 地址/端口 | 说明 |
| --- | --- | --- |
| 前端 | `172.22.3.76:189` | Node 静态资源和同源 API 代理 |
| Python API | `127.0.0.1:8000` | 仅本机监听，由前端代理访问 |
| 模型服务 | `172.22.3.76:180` | OpenAI 兼容/vLLM 接口 |

构建并发布前端：

```bash
npm run build -- /var/www/legal-service-hub
sudo systemctl restart legal-service-hub-api legal-service-hub-worker legal-service-hub
```

常用检查：

```bash
curl http://127.0.0.1:8000/health/live
curl http://127.0.0.1:8000/health/ready
curl http://127.0.0.1:8000/api/v1/capabilities
systemctl status legal-service-hub-api legal-service-hub-worker legal-service-hub
```

`/health/ready` 会检查数据库、Redis、文件存储和模型服务；`/api/v1/capabilities` 会返回当前支付、模型和注册安全能力。

## 测试与质量检查

```bash
npm run check
npm test
backend/.venv/bin/pytest -q
git diff --check
```

后端测试覆盖账户、律师入驻、模型咨询、咨询转需求、需求/报价、订单、模拟支付、回调验签、文书会签、文件访问、售后、审计和运维配置。PostgreSQL 专用并发测试需要独立测试数据库。

## 安全边界

- `backend/.env`、模型 Key、数据库、上传目录、虚拟环境和测试输出不会提交到 Git。
- 浏览器只在内存保存当前登录会话，业务事实以服务端数据库为准，不依赖 `localStorage`。
- 支付成功以服务端模拟确认或支付机构认证通知为准，浏览器不能直接修改订单金额和支付状态。
- 文件下载、律师审核、订单操作、会签和售后均执行服务端角色与资源权限校验。
- 生产部署前必须关闭演示数据、模拟支付和模型 stub，并配置强随机 JWT、PostgreSQL、Redis、HTTPS、支付证书和受限文件权限。

更多设计与实施细节见：

- [服务清单与页面调整方案](./服务清单与页面调整方案.md)
- [法律服务平台需求文档](./法律服务平台需求文档.md)
- [部署问题修复与生产完善方案](./部署问题修复与生产完善方案.md)
- [实施与验证报告](./实施与验证报告.md)
- [后端架构说明](./backend/ARCHITECTURE.md)
