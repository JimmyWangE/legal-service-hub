import asyncio
import base64
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import time
from uuid import uuid4
from zoneinfo import ZoneInfo

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi.testclient import TestClient
import httpx
import pytest

from app.core.config import Settings, get_settings
from app.core.database import SessionLocal
from app.core.errors import DomainError
from app.core.payment_security import alipay_canonical, parse_alipay_event, parse_wechat_event, verify_wechat_signature
from app.main import app
from app.models import Consent, IdempotencyRecord, LawyerApplication, LawyerProfile, Order, Payment, PaymentTransaction, PaymentWebhookInbox, ServiceRequest, UserRole
from app.services import consultation as consultation_service
from app.services import marketplace, payments
from app.services.model_provider import ModelAnswer
from app.services.health import HealthMonitor, check_storage
from tests.helpers import post_webhook, registration_payload
from tests.test_api import auth, login, reset_database


@pytest.fixture
def api():
    reset_database()
    with TestClient(app) as client:
        yield client


def create_order(client):
    client_headers = auth(login(client, "client@example.com", "client-demo-123"))
    lawyer_headers = auth(login(client, "lawyer@example.com", "lawyer-demo-123"))
    request = client.post("/api/v1/requests", headers=client_headers, json={"title": "生产修复验证需求", "domain": "民商事", "field": "合同纠纷", "service_type": "合同审阅", "facts": "这是一份用于隔离测试的合同服务需求", "region": "北京", "budget": "19.90", "deadline": "2099-01-01", "deliverables": "审阅报告"})
    assert request.status_code == 200, request.text
    quote = client.post(f"/api/v1/requests/{request.json()['id']}/quotes", headers=lawyer_headers, json={"scope": "合同审阅", "deliverables": "报告", "price": "19.90", "days": 3, "valid_until": "2099-01-01"})
    assert quote.status_code == 200, quote.text
    order = client.post(f"/api/v1/quotes/{quote.json()['id']}/accept", headers=client_headers)
    assert order.status_code == 200, order.text
    assert client.post(f"/api/v1/orders/{order.json()['id']}/confirm", headers=client_headers).status_code == 200
    confirmed = client.post(f"/api/v1/orders/{order.json()['id']}/confirm", headers=lawyer_headers)
    assert confirmed.status_code == 200, confirmed.text
    return client_headers, lawyer_headers, confirmed.json()


@pytest.fixture
def signing_keys(tmp_path, monkeypatch):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    keys_directory = tmp_path / "trusted-keys"
    keys_directory.mkdir()
    public = keys_directory / "trusted.pem"
    public.write_bytes(key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo))
    merchant_private = tmp_path / "merchant.pem"
    merchant_private.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    api_key = tmp_path / "api-v3"
    api_key.write_bytes(b"a" * 32)
    settings = get_settings()
    for name, value in {"wechatpay_verify_keys_dir": str(keys_directory), "wechatpay_api_v3_key_file": str(api_key), "wechatpay_app_id": "wx-test", "wechatpay_mch_id": "merchant-test", "wechatpay_private_key_file": str(merchant_private), "wechatpay_mch_serial_no": "merchant-serial", "wechatpay_notify_url": "https://example.com/notify", "alipay_app_id": "ali-test", "alipay_seller_id": "seller-test", "alipay_public_key_file": str(public), "alipay_private_key_file": str(merchant_private)}.items():
        monkeypatch.setattr(settings, name, value)
    return key


def sign_headers(key, raw, timestamp=None, serial="trusted"):
    timestamp = str(int(time.time()) if timestamp is None else timestamp)
    nonce = uuid4().hex
    signed = f"{timestamp}\n{nonce}\n".encode() + raw + b"\n"
    return {"Content-Type": "application/json", "Wechatpay-Timestamp": timestamp, "Wechatpay-Nonce": nonce, "Wechatpay-Serial": serial, "Wechatpay-Signature": base64.b64encode(key.sign(signed, padding.PKCS1v15(), hashes.SHA256())).decode()}


def wechat_notification(key, intent_id, amount=1990, event_id="wechat-event"):
    transaction = {"mchid": "merchant-test", "appid": "wx-test", "out_trade_no": intent_id, "transaction_id": "wx-transaction", "trade_state": "SUCCESS", "amount": {"total": amount, "currency": "CNY"}}
    ciphertext = AESGCM(b"a" * 32).encrypt(b"123456789012", json.dumps(transaction).encode(), b"transaction")
    raw = json.dumps({"id": event_id, "event_type": "TRANSACTION.SUCCESS", "resource": {"algorithm": "AEAD_AES_256_GCM", "nonce": "123456789012", "associated_data": "transaction", "ciphertext": base64.b64encode(ciphertext).decode()}}, separators=(",", ":")).encode()
    return raw, sign_headers(key, raw)


def test_wechat_signature_decryption_timestamps_and_unknown_key(signing_keys):
    raw, headers = wechat_notification(signing_keys, "intent-test")
    event = parse_wechat_event(raw, headers)
    assert event["amount"] == "19.9" and event["merchant_id"] == "merchant-test"
    for invalid_raw, invalid_headers in [(raw + b" ", headers), (raw, sign_headers(signing_keys, raw, time.time() - 301)), (raw, sign_headers(signing_keys, raw, time.time() + 301)), (raw, sign_headers(signing_keys, raw, serial="untrusted"))]:
        with pytest.raises(DomainError):
            parse_wechat_event(invalid_raw, invalid_headers)


def test_alipay_form_signature_delayed_notice_and_duplicate_fields(signing_keys):
    from urllib.parse import urlencode

    parameters = {"app_id": "ali-test", "seller_id": "seller-test", "notify_id": "ali-notice", "notify_time": (datetime.now(ZoneInfo("Asia/Shanghai")) - timedelta(hours=20)).strftime("%Y-%m-%d %H:%M:%S"), "out_trade_no": "intent-test", "trade_no": "ali-transaction", "total_amount": "19.90", "trade_status": "TRADE_SUCCESS", "sign_type": "RSA2"}
    parameters["sign"] = base64.b64encode(signing_keys.sign(alipay_canonical(parameters).encode(), padding.PKCS1v15(), hashes.SHA256())).decode()
    raw = urlencode(parameters).encode()
    assert parse_alipay_event(raw)["requires_query"] is False
    for invalid in (raw + b"&seller_id=attacker", raw.replace(b"19.90", b"20.00")):
        with pytest.raises(DomainError):
            parse_alipay_event(invalid)
    parameters["notify_time"] = (datetime.now(ZoneInfo("Asia/Shanghai")) - timedelta(hours=30)).strftime("%Y-%m-%d %H:%M:%S")
    parameters["sign"] = base64.b64encode(signing_keys.sign(alipay_canonical(parameters).encode(), padding.PKCS1v15(), hashes.SHA256())).decode()
    assert parse_alipay_event(urlencode(parameters).encode())["requires_query"] is True


def test_registration_challenge_is_required_and_single_use(api):
    challenge = api.get("/api/v1/auth/registration-challenge")
    assert challenge.status_code == 200, challenge.text
    question = challenge.json()["question"]
    left, right = [int(value) for value in question.replace(" = ?", "").split(" + ")]
    payload = {"email": "challenge-user@example.test", "name": "问答用户", "password": "challenge-pass-123", "challenge_id": challenge.json()["id"], "challenge_answer": str(left + right)}

    invalid = api.post("/api/v1/auth/register", json={**payload, "challenge_answer": str(left + right + 1)})
    assert invalid.status_code == 422
    registered = api.post("/api/v1/auth/register", json=payload)
    assert registered.status_code == 200, registered.text
    assert registered.json()["user"]["email_verified"] is True

    replay = api.post("/api/v1/auth/register", json={**payload, "email": "challenge-replay@example.test"})
    assert replay.status_code == 422


def test_summary_generates_editable_request_draft_from_model(api, monkeypatch):
    class FixedProvider:
        def answer(self, prompt, topic, context=None):
            return ModelAnswer(text='```json\n{"title":"劳动合同解除争议","domain":"劳动争议","field":"劳动合同","service_type":"劳动仲裁咨询","region":"北京市","budget":"约3500元","deadline":"2026年11月30日","facts":"用户希望核对解除通知是否合法并计算应付补偿。","deliverables":"仲裁方案、补偿测算和证据清单","confidence":{"title":0.95}}\n```', risk=False)

    monkeypatch.setattr(consultation_service, "get_model_provider", lambda: FixedProvider())
    headers = auth(login(api, "client@example.com", "client-demo-123"))
    consultation = api.post("/api/v1/consultations", headers=headers, json={"topic": "劳动争议"}).json()
    message = api.post(f"/api/v1/consultations/{consultation['id']}/messages", headers=headers, json={"prompt": "我收到解除通知，想核对补偿和仲裁方案", "topic": "劳动争议"})
    assert message.status_code == 200, message.text
    summary = api.post(f"/api/v1/consultations/{consultation['id']}/summary", headers=headers, json={"consent": True, "scope": "需求摘要"})
    assert summary.status_code == 200, summary.text
    draft = summary.json()["summary"]["request_draft"]
    assert draft["generated_by"] == "model"
    assert draft["title"] == "劳动合同解除争议"
    assert draft["budget"] == "3500"
    assert draft["deadline"] == "2026-11-30"


def test_unsigned_stub_webhook_rejected_and_ledger_deduplicated(api):
    headers, lawyer_headers, order = create_order(api)
    payment = api.post(f"/api/v1/orders/{order['id']}/payments", headers=headers, json={}).json()
    payload = {"event_id": "event-1", "intent_id": payment["intent_id"], "status": "success", "amount": "19.90"}
    assert api.post("/api/v1/payments/webhooks/stub", json=payload).status_code == 401
    assert post_webhook(api, payload).status_code == 200
    assert post_webhook(api, payload).status_code == 200
    assert post_webhook(api, {**payload, "event_id": "different-event-same-transaction"}).status_code == 200
    assert post_webhook(api, {**payload, "status": "failed"}).status_code == 409
    assert post_webhook(api, {**payload, "event_id": "bad-amount", "amount": "20.00"}).status_code == 422
    with SessionLocal() as db:
        assert db.query(PaymentTransaction).count() == 1
        assert db.get(Order, order["id"]).paid == Decimal("19.90")
        assert db.query(PaymentWebhookInbox).count() == 2


def test_simulated_payment_books_order_and_is_idempotent(api):
    headers, _, order = create_order(api)
    payment_response = api.post(f"/api/v1/orders/{order['id']}/payments", headers=headers, json={})
    assert payment_response.status_code == 200, payment_response.text
    payment = payment_response.json()
    assert payment["provider"] == "stub"
    assert payment["client_params"]["mode"] == "simulation"
    assert payment["client_params"]["amount"] == "19.90"
    assert payment["client_params"]["qr_svg_base64"]

    simulate_headers = {**headers, "Idempotency-Key": "simulate-payment-once"}
    simulated = api.post(
        f"/api/v1/orders/{order['id']}/payments/{payment['id']}/simulate-success",
        headers=simulate_headers,
        json={},
    )
    assert simulated.status_code == 200, simulated.text
    assert simulated.json()["status"] == "success"

    repeated = api.post(
        f"/api/v1/orders/{order['id']}/payments/{payment['id']}/simulate-success",
        headers={**headers, "Idempotency-Key": "simulate-payment-again"},
        json={},
    )
    assert repeated.status_code == 200, repeated.text
    assert repeated.json()["status"] == "success"

    with SessionLocal() as db:
        saved_order = db.get(Order, order["id"])
        saved_payment = db.get(Payment, payment["id"])
        assert saved_order.payment_status == "paid"
        assert saved_order.status == "service"
        assert saved_order.paid == Decimal("19.90")
        assert saved_payment.transaction_id == f"simulated-{payment['intent_id']}"
        assert db.query(PaymentTransaction).filter_by(payment_id=payment["id"]).count() == 1


def test_wechat_ack_is_empty_204_and_durable_worker_recovers(api, signing_keys, monkeypatch):
    headers, lawyer_headers, order = create_order(api)
    settings = get_settings()
    monkeypatch.setattr(settings, "payment_provider", "wechatpay")
    payment_response = api.post(f"/api/v1/orders/{order['id']}/payments", headers=headers, json={})
    assert payment_response.status_code == 200, payment_response.text
    payment = payment_response.json()
    raw, signature_headers = wechat_notification(signing_keys, payment["intent_id"])
    response = api.post("/api/v1/payments/webhooks/wechatpay", content=raw, headers=signature_headers)
    assert response.status_code == 204 and response.content == b""
    with SessionLocal() as db:
        assert db.query(PaymentWebhookInbox).one().status == "pending"
        assert db.query(PaymentTransaction).count() == 0
    with SessionLocal.begin() as db:
        assert payments.process_inbox_once(db)
    with SessionLocal.begin() as db:
        assert not payments.process_inbox_once(db)
    with SessionLocal() as db:
        assert db.query(PaymentTransaction).count() == 1
        assert db.get(Order, order["id"]).payment_status == "paid"
    assert api.post("/api/v1/payments/webhooks/wechatpay", content=raw, headers=signature_headers).status_code == 204


def test_business_idempotency_audit_and_outbox_rollback_together(api, monkeypatch):
    headers = {**auth(login(api, "client@example.com", "client-demo-123")), "Idempotency-Key": "atomic-request"}
    payload = {"title": "事务回滚测试", "domain": "民商事", "field": "合同", "service_type": "审阅", "facts": "事务失败时不得残留业务与幂等记录", "region": "北京", "budget": "19.90", "deadline": "2099-01-01", "deliverables": "报告"}
    original = marketplace.commit_event

    def fail_event(*arguments, **keywords):
        raise DomainError("注入事务失败", 503, "test_failure")

    monkeypatch.setattr(marketplace, "commit_event", fail_event)
    assert api.post("/api/v1/requests", headers=headers, json=payload).status_code == 503
    with SessionLocal() as db:
        assert db.query(ServiceRequest).count() == 0
        assert db.query(IdempotencyRecord).count() == 0
    monkeypatch.setattr(marketplace, "commit_event", original)
    first = api.post("/api/v1/requests", headers=headers, json=payload)
    second = api.post("/api/v1/requests", headers=headers, json=payload)
    assert first.status_code == second.status_code == 200
    assert first.json()["id"] == second.json()["id"]
    assert api.post("/api/v1/requests", headers=headers, json={**payload, "title": "另一个意图"}).status_code == 409


def test_lawyer_self_application_review_dual_role_and_freeze(api):
    registration = api.post("/api/v1/auth/register", json=registration_payload(api, "new-lawyer@example.test", "新入驻用户", "new-lawyer-test-pass", "lawyer")).json()
    headers = auth(registration["access_token"])
    user_id = registration["user"]["id"]
    assert registration["user"]["roles"] == ["client"]
    tampered = api.post("/api/v1/auth/register", json={"email": "tamper@example.test", "name": "攻击者", "password": "test-password", "role": "operator"})
    assert tampered.status_code == 422
    payload = {"firm": "真实核验测试律所", "region": "北京", "field": "合同纠纷", "mode": "线上服务", "license_number": "test-unique-license", "expires_on": "2099-01-01"}
    applied = api.post("/api/v1/lawyers/me/application", headers=headers, json=payload)
    assert applied.status_code == 200, applied.text
    assert api.post("/api/v1/lawyers/me/application", headers=headers, json=payload).status_code == 409
    assert api.get("/api/v1/admin/lawyer-applications", headers=headers).status_code == 403
    operator = auth(login(api, "operator@example.com", "operator-demo-123"))
    identity = applied.json()["id"]
    decision = {"decision": "approve", "reason": "管理员同意入驻", "expected_version": 1}
    assert api.post(f"/api/v1/admin/lawyer-applications/{identity}/review", headers=headers, json=decision).status_code == 403
    assert api.post(f"/api/v1/admin/lawyer-applications/{identity}/review", headers=operator, json=decision).status_code == 200
    assert api.post(f"/api/v1/admin/lawyer-applications/{identity}/review", headers=operator, json=decision).status_code == 409
    assert api.get("/api/v1/auth/me", headers=headers).json()["roles"] == ["client", "lawyer"]
    assert api.post("/api/v1/consultations", headers=headers, json={}).status_code == 200
    amended = api.post("/api/v1/lawyers/me/application", headers=headers, json={**payload, "firm": "未经核准的新律所"}).json()
    assert amended["version"] == 2
    assert api.get("/api/v1/lawyers/me", headers=headers).json()["firm"] == payload["firm"]
    assert api.post(f"/api/v1/admin/lawyers/{user_id}/freeze", headers=operator, json={"reason": "风险核查暂停新服务"}).status_code == 200
    assert all(item["id"] != user_id for item in api.get("/api/v1/lawyers", headers=headers).json())
    assert all("email" not in item and "license_number" not in item for item in api.get("/api/v1/lawyers", headers=headers).json())


@pytest.mark.parametrize("component,expected", [("model", 200), ("database", 503), ("redis", 503), ("storage", 503)])
def test_readiness_dependency_policy_and_staleness(component, expected):
    monitor = HealthMonitor()
    try:
        monitor.components = {name: {"status": "ok"} for name in ("database", "redis", "storage", "model")}
        monitor.checked_monotonic = time.monotonic()
        monitor.components[component] = {"status": "failed"}
        assert monitor.snapshot()[0] == expected
        assert monitor.snapshot(model_required=True)[0] == 503
        monitor.checked_monotonic -= 20
        assert monitor.snapshot()[0] == 503
    finally:
        monitor.executor.shutdown(wait=False)


def test_storage_real_write_read_and_failure(tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "upload_dir", str(tmp_path))
    check_storage()
    assert list((tmp_path / ".health").iterdir()) == []
    file = tmp_path / "not-a-directory"
    file.write_text("x")
    monkeypatch.setattr(get_settings(), "upload_dir", str(file))
    with pytest.raises(OSError):
        check_storage()


def test_production_configuration_fails_closed(tmp_path):
    with pytest.raises(ValueError):
        Settings(_env_file=None, app_env="production")
    key = tmp_path / "model-key"
    key.write_text("isolated-test-key")
    values = dict(app_env="production", jwt_secret="strong-random-value-not-for-real-use-123456789", database_url="postgresql+psycopg://test@localhost/test", redis_url="redis://localhost", seed_demo_data=False, upload_dir=str(tmp_path), model_provider="openai_compatible", model_api_key_file=str(key), model_name="test-model", payment_provider="disabled", payment_stub_enabled=False, require_verified_email=True, public_base_url="https://legal.example.test", rate_limit_per_minute=120)
    assert Settings(_env_file=None, **values).payment_provider == "disabled"
    for mutation in ({"seed_demo_data": True}, {"payment_provider": "stub"}, {"model_fallback_to_stub": True}, {"redis_url": ""}, {"jwt_secret": "change-me"}):
        with pytest.raises(ValueError):
            Settings(_env_file=None, **{**values, **mutation})


def test_concurrent_duplicate_callbacks_and_multiple_payment_intents(api):
    from concurrent.futures import ThreadPoolExecutor
    from app.core.database import engine

    if engine.dialect.name != "postgresql":
        pytest.skip("并发锁语义必须在PostgreSQL专用测试库验证")
    headers, lawyer_headers, order = create_order(api)

    def create_payment(index):
        return api.post(f"/api/v1/orders/{order['id']}/payments", headers={**headers, "Idempotency-Key": f"parallel-{index}"}, json={})

    with ThreadPoolExecutor(max_workers=8) as executor:
        responses = list(executor.map(create_payment, range(16)))
    assert all(response.status_code == 200 for response in responses)
    assert len({response.json()["id"] for response in responses}) == 1
    payment = responses[0].json()
    payload = {"event_id": "parallel-notification", "intent_id": payment["intent_id"], "status": "success", "amount": "19.90"}

    def deliver_callback(index):
        for attempt in range(20):
            response = post_webhook(api, payload)
            if response.status_code not in {429, 503}:
                return response.status_code
            time.sleep(0.05)
        return response.status_code

    with ThreadPoolExecutor(max_workers=16) as executor:
        assert list(executor.map(deliver_callback, range(100))) == [200] * 100
    with SessionLocal() as db:
        assert db.query(PaymentWebhookInbox).count() == 1
        assert db.query(PaymentTransaction).count() == 1
        assert db.get(Order, order["id"]).paid == Decimal("19.90")
