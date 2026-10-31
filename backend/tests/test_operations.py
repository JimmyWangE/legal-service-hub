import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from decimal import Decimal
import json
from pathlib import Path
import socket
import subprocess
import sys
from threading import Barrier
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding
import httpx
import pytest
import redis
from sqlalchemy import Column, MetaData, Table, create_engine, text

from app.core.config import get_settings
from app.core.database import Base, SessionLocal, engine
from app.core.errors import DomainError
from app.core.rate_limit import RateLimiter
from app.main import app
from app.models import AuditLog, ConsultationMessage, Order, Payment, PaymentTransaction
from app.services import health
from app.services.model_provider import FallbackModelProvider, ModelAnswer, OpenAICompatibleProvider, get_model_provider
from app.services.payment_provider import AlipayProvider, WechatPayProvider
from app.services.reconciliation import columns, reconcile_statement
from tests.helpers import post_webhook
from tests.test_remediation import api, create_order, signing_keys


def test_password_change_revokes_existing_sessions(api):
    session = api.post("/api/v1/auth/login", json={"email": "client@example.com", "password": "client-demo-123"}).json()
    headers = {"Authorization": "Bearer " + session["access_token"]}
    assert api.post("/api/v1/auth/password", headers=headers, json={"old_password": "bad-password", "new_password": "new-isolated-password"}).status_code == 403
    assert api.post("/api/v1/auth/password", headers=headers, json={"old_password": "client-demo-123", "new_password": "new-isolated-password"}).status_code == 200
    assert api.get("/api/v1/auth/me", headers=headers).status_code == 401
    assert api.post("/api/v1/auth/login", json={"email": "client@example.com", "password": "client-demo-123"}).status_code == 401
    assert api.post("/api/v1/auth/login", json={"email": "client@example.com", "password": "new-isolated-password"}).status_code == 200


def test_metrics_export_has_bounded_route_labels_and_no_secrets(api):
    api.get("/api/v1/requests/private-test-identifier")
    response = api.get("/metrics")
    assert response.status_code == 200
    assert "text/plain" in response.headers["content-type"]
    assert "legal_http_requests_total" in response.text
    assert "legal_component_ready" in response.text
    assert "private-test-identifier" not in response.text
    assert "client@example.com" not in response.text
    assert get_settings().jwt_secret not in response.text


def test_real_redis_probe_rate_limit_failure_and_recovery(tmp_path, monkeypatch):
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    secret = uuid4().hex
    config = tmp_path / "redis.conf"
    config.write_text(f"bind 127.0.0.1\nport {port}\ndir {tmp_path}\nsave \"\"\nappendonly no\nrequirepass {secret}\n")
    process = subprocess.Popen(["redis-server", str(config)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    client = redis.Redis(host="127.0.0.1", port=port, password=secret, decode_responses=True)
    import time

    try:
        for attempt in range(50):
            try:
                if client.ping():
                    break
            except redis.RedisError:
                time.sleep(0.02)
        settings = get_settings()
        monkeypatch.setattr(settings, "redis_url", f"redis://:{secret}@127.0.0.1:{port}/0")
        monkeypatch.setattr(settings, "app_env", "staging")
        monkeypatch.setattr(settings, "rate_limit_per_minute", 3)
        health.check_redis()
        assert not client.keys("health:*")
        limiter = RateLimiter()
        assert [limiter.allow("isolated-user") for attempt in range(4)] == [True, True, True, False]
        key = client.keys("rate:*")[0]
        assert 0 < client.ttl(key) <= 61
        process.terminate()
        process.wait(timeout=5)
        with pytest.raises(DomainError) as failed:
            limiter.allow("isolated-user")
        assert failed.value.code == "rate_limit_unavailable"
        assert health.measured(health.check_redis)["status"] == "failed"
        process = subprocess.Popen(["redis-server", str(config)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for attempt in range(50):
            if health.measured(health.check_redis)["status"] == "ok":
                break
            time.sleep(0.02)
        assert health.measured(health.check_redis)["status"] == "ok"
        limiter._redis.close()
    finally:
        client.close()
        process.terminate()
        process.wait(timeout=5)


def test_model_timeout_has_no_demo_fallback_and_rolls_back(api, monkeypatch):
    headers, lawyer, order = create_order(api)
    created = api.post("/api/v1/consultations", headers=headers, json={"topic": "合同", "title": "模型失败事务"}).json()

    def unavailable(*arguments, **keywords):
        raise DomainError("模型服务暂不可用", 503, "model_unavailable")

    monkeypatch.setattr(get_model_provider(), "answer", unavailable)
    result = api.post(f"/api/v1/consultations/{created['id']}/messages", headers={**headers, "Idempotency-Key": "retry-after-model-fault"}, json={"prompt": "请分析合同履约风险", "topic": "合同"})
    assert result.status_code == 503 and result.json()["error"]["code"] == "model_unavailable"
    with SessionLocal() as db:
        assert db.query(ConsultationMessage).filter_by(consultation_id=created["id"]).count() == 0


def test_request_visibility_deadline_and_document_members_are_server_enforced(api):
    headers, _, order = create_order(api)
    invalid_visibility = api.post(
        "/api/v1/requests",
        headers=headers,
        json={
            "title": "越权公开范围测试",
            "domain": "民事",
            "field": "合同纠纷",
            "service_type": "合同审阅",
            "facts": "这是用于验证公开范围边界的测试内容。",
            "region": "北京",
            "budget": "100",
            "deadline": "2099-01-01",
            "deliverables": "审阅意见",
            "visibility": "仅本人",
        },
    )
    assert invalid_visibility.status_code == 422

    invalid_deadline = api.post(
        "/api/v1/requests",
        headers=headers,
        json={
            "title": "过期日期测试",
            "domain": "民事",
            "field": "合同纠纷",
            "service_type": "合同审阅",
            "facts": "这是用于验证截止日期边界的测试内容。",
            "region": "北京",
            "budget": "100",
            "deadline": "2000-01-01",
            "deliverables": "审阅意见",
        },
    )
    assert invalid_deadline.status_code == 422

    invalid_members = api.post(
        "/api/v1/documents",
        headers=headers,
        json={"order_id": order["id"], "title": "越权参与人测试", "body": "正文", "members": ["operator"]},
    )
    assert invalid_members.status_code == 422
    assert invalid_members.json()["error"]["code"] == "invalid_member"


def test_streaming_consultation_emits_chunks_persists_and_replays(api):
    headers, _, _ = create_order(api)
    created = api.post("/api/v1/consultations", headers=headers, json={"topic": "合同", "title": "流式咨询"}).json()
    stream_headers = {**headers, "Idempotency-Key": "streaming-consultation-key"}
    payload = {"prompt": "请分点说明合同履约风险和下一步准备事项", "topic": "合同", "context_enabled": True}

    response = api.post(f"/api/v1/consultations/{created['id']}/messages/stream", headers=stream_headers, json=payload)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert "event: start" in response.text
    assert response.text.count("event: chunk") >= 2
    assert "event: done" in response.text
    with SessionLocal() as db:
        assert db.query(ConsultationMessage).filter_by(consultation_id=created["id"]).count() == 2

    replay = api.post(f"/api/v1/consultations/{created['id']}/messages/stream", headers=stream_headers, json=payload)
    assert replay.status_code == 200
    assert replay.headers["content-type"].startswith("application/json")
    assert len(replay.json()["messages"]) == 2


def test_model_http_timeout_and_role_separated_history(tmp_path, monkeypatch):
    key = tmp_path / "model-key"
    key.write_text("isolated-key")
    monkeypatch.setattr(get_settings(), "model_api_key_file", str(key))
    monkeypatch.setattr(get_settings(), "model_name", "isolated-model")
    monkeypatch.setattr(get_settings(), "model_max_tokens", 2000)
    monkeypatch.setattr(get_settings(), "model_enable_thinking", False)
    provider = OpenAICompatibleProvider()

    def timeout(request):
        body = json.loads(request.content)
        assert body["messages"][0]["role"] == "system"
        assert body["messages"][1] == {"role": "user", "content": "用户历史不是系统提示"}
        assert "用户历史不是系统提示" not in body["messages"][0]["content"]
        assert body["chat_template_kwargs"]["enable_thinking"] is False
        assert body["max_tokens"] == 2000
        raise httpx.ReadTimeout("isolated timeout", request=request)

    provider.client.close()
    provider.client = httpx.Client(base_url="http://model.test/v1/", transport=httpx.MockTransport(timeout))
    try:
        with pytest.raises(DomainError) as failed:
            provider.answer("查询合同", "合同", [{"role": "user", "content": "用户历史不是系统提示"}])
        assert failed.value.code == "model_unavailable"
        assert provider.capacity.acquire(blocking=False)
        provider.capacity.release()
    finally:
        provider.client.close()


def test_model_stream_continues_after_length(tmp_path, monkeypatch):
    key = tmp_path / "model-key"
    key.write_text("isolated-key")
    monkeypatch.setattr(get_settings(), "model_api_key_file", str(key))
    monkeypatch.setattr(get_settings(), "model_name", "isolated-model")
    monkeypatch.setattr(get_settings(), "model_max_tokens", 2000)
    monkeypatch.setattr(get_settings(), "model_enable_thinking", False)
    provider = OpenAICompatibleProvider()
    calls = []

    def stream_response(request):
        body = json.loads(request.content)
        calls.append(body)
        if len(calls) == 1:
            chunks = [
                {"choices": [{"delta": {"content": "第一段"}, "finish_reason": None}]},
                {"choices": [{"delta": {}, "finish_reason": "length"}]},
            ]
        else:
            assert body["messages"][-2]["role"] == "assistant"
            assert body["messages"][-2]["content"] == "第一段"
            chunks = [
                {"choices": [{"delta": {"content": "第二段"}, "finish_reason": None}]},
                {"choices": [{"delta": {}, "finish_reason": "stop"}]},
            ]
        raw = "\n".join(f"data: {json.dumps(item)}" for item in chunks) + "\ndata: [DONE]\n\n"
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=raw.encode(), request=request)

    provider.client.close()
    provider.client = httpx.Client(base_url="http://model.test/v1/", transport=httpx.MockTransport(stream_response))
    try:
        assert "".join(provider.stream_answer("查询合同", "合同")) == "第一段第二段"
        assert len(calls) == 2
    finally:
        provider.client.close()


def test_stream_fallback_does_not_append_stub_after_partial_primary_output():
    class PartialFailure:
        def answer(self, prompt, topic, context=None):
            raise DomainError("模型不可用", 503, "model_unavailable")

        def stream_answer(self, prompt, topic, context=None):
            yield "真实模型已输出"
            raise DomainError("连接中断", 503, "model_unavailable")

    class Stub:
        def answer(self, prompt, topic, context=None):
            return ModelAnswer("备用完整回答", False)

        def stream_answer(self, prompt, topic, context=None):
            yield "备用完整回答"

    with pytest.raises(DomainError):
        list(FallbackModelProvider(PartialFailure(), Stub()).stream_answer("问题", "合同"))


def test_payment_outbound_contracts_and_qr(signing_keys, monkeypatch):
    payment = SimpleNamespace(intent_id="contract-intent", amount=Decimal("19.90"), expires_at=datetime.now(timezone.utc))
    provider = WechatPayProvider()
    calls = []

    def native(method, endpoint, payload):
        calls.append(payload)
        return {"code_url": "weixin://wxpay/bizpayurl?pr=isolated"}

    monkeypatch.setattr(provider, "request", native)
    result = provider.create_intent(payment, "合同服务")
    assert calls[0]["amount"]["total"] == 1990
    assert b"<svg" in base64.b64decode(result["qr_svg_base64"])
    alipay = AlipayProvider()
    parameters = {name: values[0] for name, values in parse_qs(urlparse(alipay.create_intent(payment, "合同服务")["pay_url"]).query).items()}
    signed = "&".join(f"{name}={value}" for name, value in sorted(parameters.items()) if name != "sign")
    signing_keys.public_key().verify(base64.b64decode(parameters["sign"]), signed.encode(), padding.PKCS1v15(), hashes.SHA256())
    assert parameters["sign_type"] == "RSA2"


def test_statement_reconciliation_is_durable_deduplicated_and_never_changes_money(api):
    headers, lawyer, order = create_order(api)
    payment = api.post(f"/api/v1/orders/{order['id']}/payments", headers=headers, json={"provider": "stub"}).json()
    assert post_webhook(api, {"event_id": "statement-event", "intent_id": payment["intent_id"], "transaction_id": "statement-transaction", "status": "success", "amount": "19.90"}).status_code == 200
    day = datetime.now().astimezone().date().isoformat()
    raw = (",".join(columns) + f"\nstub,stub-merchant,{day},payment,{payment['intent_id']},statement-transaction,,19.90,CNY\n").encode()
    with SessionLocal.begin() as db:
        merchant = db.get(Payment, payment["id"]).merchant_id
        raw = raw.replace(b"stub-merchant", merchant.encode())
        report = reconcile_statement(db, raw, day, "stub", merchant, "隔离测试：模拟可信账单校验")
        assert report["status"] == "matched" and not report["money_writes"]
    with SessionLocal.begin() as db:
        assert reconcile_statement(db, raw, day, "stub", merchant, "隔离测试：模拟可信账单校验")["id"] == report["id"]
        mismatch = reconcile_statement(db, raw.replace(b"19.90", b"18.90"), day, "stub", merchant, "隔离测试：模拟差错账单校验")
        assert mismatch["status"] == "manual_review"
        assert db.query(AuditLog).filter_by(action="payment.reconciled").count() == 2
        assert db.get(Order, order["id"]).paid == Decimal("19.90")
        assert db.query(PaymentTransaction).count() == 1


def test_same_consultation_concurrent_updates_return_explicit_conflict(api, monkeypatch):
    if engine.dialect.name != "postgresql":
        pytest.skip("真实行锁和并发更新仅在隔离PostgreSQL验证")
    headers, lawyer, order = create_order(api)
    created = api.post("/api/v1/consultations", headers=headers, json={"topic": "合同"}).json()
    provider = get_model_provider()
    original = provider.answer
    barrier = Barrier(2)

    def answer(*arguments, **keywords):
        barrier.wait(timeout=5)
        return original(*arguments, **keywords)

    monkeypatch.setattr(provider, "answer", answer)
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda index: api.post(f"/api/v1/consultations/{created['id']}/messages", headers=headers, json={"prompt": f"并发测试合同咨询{index}", "topic": "合同"}).status_code, range(2)))
    assert sorted(results) == [200, 409]
    with SessionLocal() as db:
        assert [message.sequence for message in db.query(ConsultationMessage).filter_by(consultation_id=created["id"]).order_by(ConsultationMessage.sequence)] == [1, 2]


def test_fresh_and_legacy_migrations_preserve_identity_and_freeze_unverified_lawyer(tmp_path):
    import os
    repository = Path(__file__).resolve().parents[2]
    added = {"health_probes", "payment_webhook_inbox", "email_verifications", "registration_challenges", "lawyer_applications", "user_roles", "lawyer_review_records", "payment_transactions", "refunds", "chat_conversations", "chat_messages"}
    removed = {"users": {"email_verified", "token_version", "avatar_data"}, "lawyer_profiles": {"approved_application_id"}, "consultations": {"version"}, "consultation_messages": {"sequence", "source"}, "consents": {"snapshot_json"}, "service_requests": {"consent_id"}, "after_sales_cases": {"previous_order_status", "previous_settlement_status"}, "payments": {"merchant_id", "transaction_id", "client_params", "expires_at", "refunded", "attempts", "next_attempt_at"}}
    legacy = MetaData()
    for table in Base.metadata.sorted_tables:
        if table.name not in added:
            Table(table.name, legacy, *(Column(column.name, column.type, primary_key=column.primary_key, nullable=column.nullable, default=column.default) for column in table.columns if column.name not in removed.get(table.name, set())))
    path = tmp_path / "legacy.db"
    legacy_engine = create_engine(f"sqlite:///{path}")
    legacy.create_all(legacy_engine)
    with legacy_engine.begin() as connection:
        connection.execute(legacy.tables["users"].insert(), [{"id": "historic-lawyer", "email": "historic@example.test", "name": "历史律师", "password_hash": "not-a-real-password", "role": "lawyer", "is_active": True}, {"id": "C1", "email": "client@example.com", "name": "历史演示账户", "password_hash": "not-a-real-password", "role": "client", "is_active": True}])
        connection.execute(legacy.tables["lawyer_profiles"].insert(), {"user_id": "historic-lawyer", "firm": "待核验律所", "region": "北京", "field": "合同", "mode": "独立", "license_number": "old-unverified", "expires_on": datetime(2099, 1, 1).date(), "credential_files": [], "status": "approved", "available": True})
        connection.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL PRIMARY KEY)"))
        connection.execute(text("INSERT INTO alembic_version VALUES ('20261016_01')"))
    process_env = {**os.environ, "DATABASE_URL": f"sqlite:///{path}", "PYTHONPATH": str(repository / "backend")}
    result = subprocess.run([sys.executable, "-m", "alembic", "-c", "backend/alembic.ini", "upgrade", "head"], cwd=repository, env=process_env, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr[-3000:]
    with legacy_engine.connect() as connection:
        assert connection.execute(text("SELECT role FROM user_roles WHERE user_id = 'historic-lawyer'")).scalar() == "client"
        assert connection.execute(text("SELECT status FROM lawyer_profiles WHERE user_id = 'historic-lawyer'")).scalar() == "frozen"
        assert not connection.execute(text("SELECT is_active FROM users WHERE id = 'C1'")).scalar()
        assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar() == "20261031_08"
    legacy_engine.dispose()
    process_env["DATABASE_URL"] = f"sqlite:///{tmp_path / 'fresh.db'}"
    result = subprocess.run([sys.executable, "-m", "alembic", "-c", "backend/alembic.ini", "upgrade", "head"], cwd=repository, env=process_env, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr[-3000:]
    result = subprocess.run([sys.executable, "-m", "alembic", "-c", "backend/alembic.ini", "check"], cwd=repository, env=process_env, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr[-3000:]
