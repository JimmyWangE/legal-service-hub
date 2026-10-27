import os
from tests.helpers import post_webhook, registration_payload
from datetime import date, timedelta
from decimal import Decimal

os.environ.setdefault("DATABASE_URL", "sqlite:///./backend/data/test_e2e.db")
os.environ.setdefault("SEED_DEMO_DATA", "true")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("MODEL_PROVIDER", "stub")

from fastapi.testclient import TestClient

from app.bootstrap import seed_demo_data
from app.core.database import Base, SessionLocal, engine, init_db
from app.main import app
from app.models import (
    AuditLog,
    Consultation,
    ConsultationFeedback,
    ConsultationMessage,
    Consent,
    Document,
    Notification,
    Order,
    OutboxEvent,
    Payment,
    Quote,
    ServiceRequest,
    StoredFile,
    WorkflowTask,
)


def reset_database():
    Base.metadata.drop_all(bind=engine)
    init_db()
    db = SessionLocal()
    try:
        seed_demo_data(db)
    finally:
        db.close()


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def json_response(response, expected_status: int = 200):
    assert response.status_code == expected_status, response.text
    return response.json()


def login(client: TestClient, email: str, password: str) -> str:
    payload = json_response(client.post("/api/v1/auth/login", json={"email": email, "password": password}))
    return payload["access_token"]


def test_complete_platform_business_chain():
    reset_database()
    with TestClient(app) as client:
        assert json_response(client.get("/health/live")) == {"status": "ok"}
        assert json_response(client.get("/health/ready"))["components"]["database"]["status"] == "ok"

        registered = json_response(
            client.post(
                "/api/v1/auth/register",
                json=registration_payload(client, "e2e-client@example.com", "端到端客户", "e2e-client-123"),
            )
        )
        assert registered["user"]["role"] == "client"
        assert registered["user"]["email_verified"] is True
        current = json_response(client.get("/api/v1/auth/me", headers=auth(registered["access_token"])))
        assert {name: current[name] for name in registered["user"]} == registered["user"]
        assert current["lawyer_profile"] is None
        assert current["lawyer_application"] is None
        assert client.post(
            "/api/v1/auth/register",
                json=registration_payload(client, "e2e-client@example.com", "重复客户", "e2e-client-123"),
        ).status_code == 409
        assert client.get("/api/v1/auth/me").status_code == 401

        client_token = login(client, "client@example.com", "client-demo-123")
        lawyer_token = login(client, "lawyer@example.com", "lawyer-demo-123")
        operator_token = login(client, "operator@example.com", "operator-demo-123")

        lawyer_application = json_response(
            client.post(
                "/api/v1/lawyers/me/application",
                headers=auth(lawyer_token),
                json={
                    "firm": "端到端律师事务所",
                    "region": "北京",
                    "field": "合同纠纷",
                    "mode": "线上服务",
                    "license_number": "E2E-LICENSE-001",
                    "expires_on": str(date.today() + timedelta(days=365)),
                },
            )
        )
        assert lawyer_application["status"] == "submitted"
        pending = json_response(client.get("/api/v1/admin/lawyer-applications", headers=auth(operator_token)))
        assert any(item["user_id"] == "L1" and item["status"] == "submitted" for item in pending)
        reviewed = json_response(
            client.post(f"/api/v1/admin/lawyer-applications/{lawyer_application['id']}/review", headers=auth(operator_token), json={"decision": "approve", "reason": "管理员同意入驻", "expected_version": lawyer_application["version"]})
        )
        assert reviewed["status"] == "approved"
        assert json_response(client.get("/api/v1/lawyers/me", headers=auth(lawyer_token)))["available"] is True
        lawyers = json_response(client.get("/api/v1/lawyers", headers=auth(client_token)))
        assert any(item["id"] == "L1" and item["status"] == "approved" for item in lawyers)

        consultation = json_response(
            client.post("/api/v1/consultations", headers=auth(client_token), json={"topic": "合同纠纷", "title": "E2E咨询"})
        )
        consultation_id = consultation["id"]
        message = json_response(
            client.post(
                f"/api/v1/consultations/{consultation_id}/messages",
                headers=auth(client_token),
                json={"prompt": "对方没有按合同交付，我该怎么办？", "topic": "合同纠纷", "context_enabled": True},
            )
        )
        assert [item["role"] for item in message["messages"]] == ["user", "assistant"]
        assistant_message_id = message["messages"][-1]["id"]
        json_response(
            client.post(
                f"/api/v1/consultations/{consultation_id}/feedback",
                headers=auth(client_token),
                json={"message_id": assistant_message_id, "value": "有用", "reason": "回答完整"},
            )
        )
        assert client.post(
            f"/api/v1/consultations/{consultation_id}/summary",
            headers=auth(client_token),
            json={"consent": False, "scope": "需求摘要"},
        ).status_code == 422
        summary = json_response(
            client.post(
                f"/api/v1/consultations/{consultation_id}/summary",
                headers=auth(client_token),
                json={"consent": True, "scope": "需求摘要"},
            )
        )
        assert summary["consultation_id"] == consultation_id

        request = json_response(
            client.post(
                "/api/v1/requests",
                headers=auth(client_token),
                json={
                    "title": "E2E合同审阅",
                    "domain": "民事",
                    "field": "合同纠纷",
                    "service_type": "合同审阅",
                    "facts": "需要核对采购合同中的付款、交付和违约责任条款。",
                    "region": "北京",
                    "budget": "2000",
                    "deadline": "2099-01-01",
                    "deliverables": "审阅意见和修改稿",
                    "visibility": "认证律师可见",
                    "source_consultation_id": consultation_id,
                    "consent_id": summary["consent_id"],
                    "consent": True,
                },
            )
        )
        request_id = request["id"]
        assert request["status"] == "quoting"
        assert any(item["id"] == request_id for item in json_response(client.get("/api/v1/requests", headers=auth(client_token))))
        assert json_response(client.get(f"/api/v1/requests/{request_id}", headers=auth(client_token)))["id"] == request_id
        assert json_response(client.get(f"/api/v1/requests/{request_id}", headers=auth(lawyer_token)))["id"] == request_id

        quote = json_response(
            client.post(
                f"/api/v1/requests/{request_id}/quotes",
                headers=auth(lawyer_token),
                json={"scope": "审阅采购合同", "deliverables": "修改稿", "price": "1800", "days": 3, "valid_until": "2099-01-01"},
            )
        )
        quote_id = quote["id"]
        assert quote["status"] == "valid"
        assert len(json_response(client.get(f"/api/v1/requests/{request_id}/quotes", headers=auth(client_token)))) == 1

        idempotency_headers = {**auth(client_token), "Idempotency-Key": "e2e-accept-quote"}
        first_order = json_response(client.post(f"/api/v1/quotes/{quote_id}/accept", headers=idempotency_headers))
        replay_order = json_response(client.post(f"/api/v1/quotes/{quote_id}/accept", headers=idempotency_headers))
        assert first_order["id"] == replay_order["id"]
        order_id = first_order["id"]
        assert first_order["status"] == "pending_confirm"
        json_response(client.post(f"/api/v1/orders/{order_id}/confirm", headers=auth(client_token)))
        assert json_response(client.post(f"/api/v1/orders/{order_id}/confirm", headers=auth(lawyer_token)))["status"] == "pending_payment"

        payment_headers = {**auth(client_token), "Idempotency-Key": "e2e-create-payment"}
        first_payment = json_response(
            client.post(
                f"/api/v1/orders/{order_id}/payments",
                headers=payment_headers,
                json={"amount": "1800", "provider": "stub"},
            )
        )
        replay_payment = json_response(
            client.post(
                f"/api/v1/orders/{order_id}/payments",
                headers=payment_headers,
                json={"amount": "1800", "provider": "stub"},
            )
        )
        assert first_payment["id"] == replay_payment["id"]
        webhook = {"event_id": "e2e-payment-event", "intent_id": first_payment["intent_id"], "status": "success", "amount": "1800"}
        assert post_webhook(client, webhook, "wrong-provider").status_code == 503
        json_response(post_webhook(client, webhook))
        json_response(post_webhook(client, webhook))
        order = json_response(client.get(f"/api/v1/orders/{order_id}", headers=auth(client_token)))
        assert order["status"] == "service" and Decimal(str(order["paid"])) == Decimal("1800")
        assert any(item["id"] == order_id for item in json_response(client.get("/api/v1/orders", headers=auth(lawyer_token))))

        documents = json_response(client.get("/api/v1/documents", headers=auth(client_token)))
        contract = next(item for item in documents if item["order_id"] == order_id)
        assert contract["doc_type"] == "service_contract" and contract["status"] == "confirmed"
        document_id = json_response(client.post("/api/v1/documents", headers=auth(lawyer_token), json={"order_id": order_id, "title": "E2E法律意见书", "doc_type": "legal_document", "body": "E2E第一版正文"}))["id"]
        assert json_response(client.get(f"/api/v1/documents/{document_id}", headers=auth(lawyer_token)))["id"] == document_id
        version = json_response(
            client.post(
                f"/api/v1/documents/{document_id}/versions",
                headers=auth(lawyer_token),
                json={"body": "E2E第二版正文", "base_version": 1},
            )
        )
        assert version["number"] == 2
        assert client.post(
            f"/api/v1/documents/{document_id}/versions",
            headers=auth(lawyer_token),
            json={"body": "过期版本", "base_version": 1},
        ).status_code == 409
        comment = json_response(
            client.post(
                f"/api/v1/documents/{document_id}/comments",
                headers=auth(lawyer_token),
                json={"version": 2, "text": "请补充交付范围。"},
            )
        )
        assert comment["version"] == 2
        json_response(
            client.post(
                f"/api/v1/documents/{document_id}/workflow",
                headers=auth(lawyer_token),
                json={"assignee_ids": ["C1", "L1"]},
            )
        )
        json_response(
            client.post(
                f"/api/v1/documents/{document_id}/workflow/confirm",
                headers=auth(client_token),
                json={"version": 2, "reason": "客户确认"},
            )
        )
        confirmed = json_response(
            client.post(
                f"/api/v1/documents/{document_id}/workflow/confirm",
                headers=auth(lawyer_token),
                json={"version": 2, "reason": "律师确认"},
            )
        )
        assert confirmed["status"] == "confirmed"

        uploaded = json_response(
            client.post(
                "/api/v1/files",
                headers=auth(lawyer_token),
                data={"document_id": document_id},
                files={"file": ("e2e-evidence.txt", b"e2e file content", "text/plain")},
            )
        )
        downloaded = client.get(f"/api/v1/files/{uploaded['id']}", headers=auth(lawyer_token))
        assert downloaded.status_code == 200 and downloaded.content == b"e2e file content"

        delivery = json_response(
            client.post(
                f"/api/v1/orders/{order_id}/deliveries",
                headers=auth(lawyer_token),
                json={"document_id": document_id},
            )
        )
        assert delivery["status"] == "submitted"
        completed = json_response(client.post(f"/api/v1/orders/{order_id}/receipt?accepted=true", headers=auth(client_token)))
        assert completed["status"] == "completed"
        json_response(
            client.post(
                f"/api/v1/documents/{document_id}/access/C1/revoke",
                headers=auth(lawyer_token),
            )
        )
        assert client.get(f"/api/v1/files/{uploaded['id']}", headers=auth(client_token)).status_code == 403
        assert client.post(
            "/api/v1/files",
            headers=auth(client_token),
            data={"document_id": document_id},
            files={"file": ("revoked.txt", b"blocked", "text/plain")},
        ).status_code == 403
        assert client.get(f"/api/v1/files/{uploaded['id']}", headers=auth(lawyer_token)).status_code == 200
        case = json_response(
            client.post(
                f"/api/v1/orders/{order_id}/after-sales",
                headers=auth(client_token),
                json={"case_type": "refund", "reason": "E2E退款申请", "amount": "1800"},
            )
        )
        assert case["status"] == "pending"
        assert any(item["id"] == case["id"] for item in json_response(client.get("/api/v1/admin/cases", headers=auth(operator_token))))
        resolved = json_response(
            client.post(
                f"/api/v1/admin/cases/{case['id']}/resolve",
                headers=auth(operator_token),
                json={"decision": "approve", "resolution": "E2E同意退款"},
            )
        )
        assert resolved["status"] == "approved"

        notifications = json_response(client.get("/api/v1/notifications", headers=auth(client_token)))
        assert notifications
        notification_id = notifications[0]["id"]
        assert client.post(f"/api/v1/notifications/{notification_id}/read", headers=auth(lawyer_token)).status_code == 404
        assert client.post("/api/v1/notifications/not-found/read", headers=auth(client_token)).status_code == 404
        json_response(client.post(f"/api/v1/notifications/{notification_id}/read", headers=auth(client_token)))
        assert json_response(client.get("/api/v1/notifications", headers=auth(client_token)))[0]["read_at"] is not None
        audit = json_response(client.get("/api/v1/admin/audit?limit=500", headers=auth(operator_token)))
        assert any(item["action"] == "quote.accepted" for item in audit)

    db = SessionLocal()
    try:
        stored_order = db.get(Order, order_id)
        stored_request = db.get(ServiceRequest, request_id)
        stored_quote = db.get(Quote, quote_id)
        stored_consultation = db.get(Consultation, consultation_id)
        stored_document = db.get(Document, document_id)
        stored_file = db.get(StoredFile, uploaded["id"])
        assert stored_order.status == "closed"
        assert stored_order.payment_status == "paid"
        assert stored_order.settlement_status == "refunded"
        assert stored_request.status == "ordered"
        assert stored_quote.status == "accepted"
        assert stored_consultation.summary_json is not None
        assert db.query(ConsultationMessage).filter_by(consultation_id=consultation_id).count() == 2
        assert db.query(ConsultationFeedback).filter_by(message_id=assistant_message_id).count() == 1
        assert db.query(Consent).filter_by(source_id=consultation_id).count() == 1
        assert db.query(Payment).filter_by(order_id=order_id, status="success").count() == 1
        assert stored_document.status == "confirmed" and stored_document.current_version == 2
        assert db.query(WorkflowTask).filter_by(document_id=document_id, status="confirmed").count() == 2
        assert stored_file.status == "available" and stored_file.size == len(b"e2e file content")
        assert db.query(Notification).filter_by(user_id="C1").count() >= 1
        assert db.query(AuditLog).filter_by(object_id=order_id).count() >= 2
        assert db.query(OutboxEvent).filter_by(aggregate_id=order_id).count() >= 3
    finally:
        db.close()
