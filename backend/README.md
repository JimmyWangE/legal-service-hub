# Legal Service Hub Backend

这是法律服务平台的 Python 后端，按账户、咨询、需求/报价、订单/支付、文书工作流、文件、通知、售后和审计边界拆分。开发测试可使用受控 SQLite；预发布和生产使用 PostgreSQL、Redis、Alembic 迁移及独立 Worker。

## 启动

```bash
cd /home/lawsft/legal-service-hub
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
cp backend/.env.example backend/.env
PYTHONPATH=backend backend/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

打开 `http://127.0.0.1:8000/docs` 查看 OpenAPI 文档。

开发环境会创建三个演示账号：

| 角色 | 邮箱 | 密码 |
|---|---|---|
| 当事人 | `client@example.com` | `client-demo-123` |
| 律师 | `lawyer@example.com` | `lawyer-demo-123` |
| 运营 | `operator@example.com` | `operator-demo-123` |

生产环境必须设置随机 `JWT_SECRET`，并关闭 `SEED_DEMO_DATA`。

## 预发布部署

服务器部署脚本为 `scripts/install-local.sh`，会创建独立的 PostgreSQL/Redis 实例、`legal-api` 运行用户、只读模型 Key、迁移配置、静态发布目录和 systemd API/Worker。当前实例入口是 `http://172.22.3.76:189/`，API 只监听回环地址。

发布前运行 `backend/.venv/bin/python backend/scripts/manage.py validate-env`，迁移使用 `backend/.venv/bin/python backend/scripts/manage.py migrate`。`manage.py backup` 和 `restore-check` 会生成并验证受控 PostgreSQL 备份；`manage.py reconcile --file ... --date ... --provider ... --merchant-id ... --reason ...` 只接受已核验来源的规范 CSV，对账不会直接改写资金余额。

注册不依赖 SMTP 邮件服务。客户端注册前先获取 `/api/v1/auth/registration-challenge`，回答一次性算术题后提交 `challenge_id` 和 `challenge_answer`；题目有效期为5分钟，成功注册后自动完成注册校验。历史 `email_verifications` 表和旧字段保留用于数据兼容，但不再用于注册或律师入驻。

支付渠道没有完成商户签约、证书/密钥和回调联调前，必须保持 `PAYMENT_PROVIDER=disabled`。真实模型验收可运行 `backend/.venv/bin/python backend/scripts/verify-live.py`；该脚本创建临时账户、验证同源浏览器到模型到数据库链路后停用账户，不输出模型 Key。

### 内网模拟支付

如果只需要在内网联调订单、支付、履约和退款流程，可以在非生产环境显式启用模拟渠道：

```dotenv
APP_ENV=staging
PAYMENT_PROVIDER=stub
PAYMENT_STUB_ENABLED=true
PAYMENT_STUB_SECRET=请使用至少32位随机字符串
```

模拟渠道不会访问微信或支付宝，也不会产生真实资金。客户端创建支付单后，订单详情页会显示金额二维码和“已支付”按钮；后端通过 `/api/v1/orders/{order_id}/payments/{payment_id}/simulate-success` 写入与真实支付相同的支付流水、通知收件箱、审计日志和订单状态。该入口要求登录、仅允许订单当事人操作，并在 `APP_ENV=production` 下被配置校验和接口逻辑共同禁用。

模拟支付只用于内网开发和验收，正式环境仍需恢复 `PAYMENT_PROVIDER=disabled`，完成第三方商户签约、回调验签和公网 HTTPS 联调后再切换到真实渠道。

## 接入模型

模型服务使用 OpenAI 兼容接口。将 `backend/.env.example` 复制为 `backend/.env` 后确认以下配置：

```dotenv
MODEL_PROVIDER=openai_compatible
MODEL_BASE_URL=http://172.22.3.76:180/v1
MODEL_API_KEY_FILE=/home/wjs/deployLLm/.vllm_api_key
MODEL_NAME=Qwen3.8-27B
MODEL_FALLBACK_TO_STUB=false
```

API Key 只从文件读取，不写入日志、数据库或 HTTP 响应。模型服务异常时，接口返回 `503 model_unavailable`，不会伪造模型回答；如需演示环境降级，可将 Provider 改为 `stub`。

## API 分组

- `/api/v1/auth`：登录、当前用户。
- `/api/v1/consultations`：结构化问答、模型咨询、反馈、授权摘要。
- `/api/v1/requests`、`/api/v1/lawyers`、`/api/v1/quotes`：需求、律师、报价。
- `/api/v1/orders`、`/api/v1/payments`：订单、支付意图、支付回调、交付、售后。
- `/api/v1/documents`：文书版本、批注、顺序会签、访问撤销。
- `/api/v1/files`：文件上传和受控下载。
- `/api/v1/admin`：律师审核、审计查询、售后处理。

## 测试

```bash
PYTHONPATH=backend backend/.venv/bin/pytest backend/tests
```

生产部署使用 `backend/Dockerfile` 和 `backend/docker-compose.yml`。当前 Outbox 已落库，后续可将 `publish_pending` 替换为 Kafka/RocketMQ 发布 Worker；模型、支付和对象存储均通过服务边界隔离，避免外部依赖阻塞核心交易链路。
