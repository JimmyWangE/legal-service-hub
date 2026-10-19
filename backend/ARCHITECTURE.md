# 后端实现架构

## 目录

```text
backend/
├── app/
│   ├── api/                 # REST API 层：按业务域拆分路由
│   ├── core/                # 配置、数据库、安全、事件、幂等、依赖注入
│   ├── services/            # 业务逻辑和外部适配器
│   ├── bootstrap.py         # 开发环境种子数据
│   ├── models.py            # SQLAlchemy 持久化模型
│   ├── schemas.py           # Pydantic 请求契约
│   └── main.py              # FastAPI 应用和生命周期
├── tests/                   # API 闭环和权限/幂等测试
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
└── .env.example
```

## 设计对应关系

- `services/consultation.py` 对应结构化问答、法律模型咨询、风险提示、摘要授权。
- `services/marketplace.py` 对应服务需求、律师发现、报价和接受报价。
- `services/trade.py` 对应订单、支付回调、交付、退款和争议状态机。
- `services/documents.py` 对应版本、批注、访问授权和顺序会签。
- `services/files.py` 对应文件大小/格式校验、摘要指纹和受控下载。
- `services/model_provider.py`、`payment_provider.py` 是外部模型和支付适配器边界。
- `core/events.py` 使用 Outbox 表保留领域事件；生产环境可替换为 Kafka/RocketMQ Worker。

## 一致性与并发

- 报价接受、支付回调、文书会签、退款和争议均使用状态校验。
- `Idempotency-Key` 保存在 `idempotency_records`，避免重复创建订单或支付意图。
- 文书版本使用 `base_version` 乐观锁，版本冲突返回 `409`。
- 订单、支付、文书正文和审计数据分别拥有明确数据边界；金额使用 Decimal/Numeric。
- 文件正文写对象存储适配器，数据库只保存元数据和 SHA-256 指纹。

默认 SQLite 适合验收和开发；生产环境设置 PostgreSQL 的 `DATABASE_URL`，使用多副本数据库、Redis Cluster、消息队列、对象存储和多可用区 API Worker。
