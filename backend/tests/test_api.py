import os
from tests.helpers import post_webhook

os.environ.setdefault("DATABASE_URL", "sqlite:///./backend/data/test_api.db")
os.environ.setdefault("SEED_DEMO_DATA", "true")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("MODEL_PROVIDER", "stub")

from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.bootstrap import seed_demo_data
from app.core.database import Base, SessionLocal, engine, init_db
from app.main import app
from app.models import User


def reset_database():
    Base.metadata.drop_all(bind=engine)
    init_db()
    db = SessionLocal()
    try:
        seed_demo_data(db)
    finally:
        db.close()


def login(client: TestClient, email: str, password: str) -> str:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_order_payment_document_and_after_sales_flow():
    reset_database()
    with TestClient(app) as client:
        client_token = login(client, "client@example.com", "client-demo-123")
        lawyer_token = login(client, "lawyer@example.com", "lawyer-demo-123")
        operator_token = login(client, "operator@example.com", "operator-demo-123")

        request = client.post(
            "/api/v1/requests",
            headers=auth(client_token),
            json={
                "title": "测试合同审阅",
                "domain": "民事",
                "field": "合同纠纷",
                "service_type": "合同审阅",
                "facts": "需要对采购合同中的付款和交付条款进行审阅。",
                "region": "北京",
                "budget": "2000",
                "deadline": "2099-01-01",
                "deliverables": "审阅意见和修改稿",
                "visibility": "认证律师可见",
            },
        )
        assert request.status_code == 200, request.text
        request_id = request.json()["id"]

        quote = client.post(
            f"/api/v1/requests/{request_id}/quotes",
            headers=auth(lawyer_token),
            json={"scope": "审阅合同", "deliverables": "修改稿", "price": "1800", "days": 3, "valid_until": "2099-01-01"},
        )
        assert quote.status_code == 200, quote.text
        quote_id = quote.json()["id"]

        first_order = client.post(f"/api/v1/quotes/{quote_id}/accept", headers={**auth(client_token), "Idempotency-Key": "accept-1"})
        second_order = client.post(f"/api/v1/quotes/{quote_id}/accept", headers={**auth(client_token), "Idempotency-Key": "accept-1"})
        assert first_order.status_code == 200
        assert second_order.status_code == 200
        assert first_order.json()["id"] == second_order.json()["id"]
        order_id = first_order.json()["id"]

        payment = client.post(f"/api/v1/orders/{order_id}/payments", headers={**auth(client_token), "Idempotency-Key": "pay-1"}, json={"amount": "1800", "provider": "stub"})
        assert payment.status_code == 200, payment.text
        payment_data = payment.json()
        webhook = {"event_id": "evt-1", "intent_id": payment_data["intent_id"], "status": "success", "amount": "1800"}
        assert post_webhook(client, webhook).status_code == 200
        assert post_webhook(client, webhook).status_code == 200
        assert client.get(f"/api/v1/orders/{order_id}", headers=auth(client_token)).json()["status"] == "service"

        document = client.post(
            "/api/v1/documents",
            headers=auth(lawyer_token),
            json={"order_id": order_id, "title": "测试交付文书", "doc_type": "legal_document", "body": "第一版正文"},
        )
        assert document.status_code == 200, document.text
        document_id = document.json()["id"]
        stale = client.post(f"/api/v1/documents/{document_id}/versions", headers=auth(lawyer_token), json={"body": "第二版", "base_version": 1})
        assert stale.status_code == 200
        conflict = client.post(f"/api/v1/documents/{document_id}/versions", headers=auth(lawyer_token), json={"body": "冲突版", "base_version": 1})
        assert conflict.status_code == 409

        start = client.post(f"/api/v1/documents/{document_id}/workflow", headers=auth(lawyer_token), json={"assignee_ids": ["C1", "L1"]})
        assert start.status_code == 200, start.text
        confirm_client = client.post(f"/api/v1/documents/{document_id}/workflow/confirm", headers=auth(client_token), json={"version": 2, "reason": ""})
        assert confirm_client.status_code == 200, confirm_client.text
        confirm_lawyer = client.post(f"/api/v1/documents/{document_id}/workflow/confirm", headers=auth(lawyer_token), json={"version": 2, "reason": ""})
        assert confirm_lawyer.status_code == 200, confirm_lawyer.text

        delivery = client.post(f"/api/v1/orders/{order_id}/deliveries", headers=auth(lawyer_token), json={"document_id": document_id})
        assert delivery.status_code == 200, delivery.text
        receipt = client.post(f"/api/v1/orders/{order_id}/receipt?accepted=true", headers=auth(client_token))
        assert receipt.status_code == 200, receipt.text
        assert receipt.json()["status"] == "completed"

        case = client.post(f"/api/v1/orders/{order_id}/after-sales", headers=auth(client_token), json={"case_type": "refund", "reason": "测试退款", "amount": "1800"})
        assert case.status_code == 200, case.text
        resolved = client.post(f"/api/v1/admin/cases/{case.json()['id']}/resolve", headers=auth(operator_token), json={"decision": "approve", "resolution": "同意退款"})
        assert resolved.status_code == 200, resolved.text


def test_access_control_and_summary_consent():
    reset_database()
    with TestClient(app) as client:
        client_token = login(client, "client@example.com", "client-demo-123")
        lawyer_token = login(client, "lawyer@example.com", "lawyer-demo-123")
        consultation = client.post("/api/v1/consultations", headers=auth(client_token), json={"topic": "合同纠纷"})
        assert consultation.status_code == 200
        consultation_id = consultation.json()["id"]
        message = client.post(f"/api/v1/consultations/{consultation_id}/messages", headers=auth(client_token), json={"prompt": "对方没有按合同交付，我该怎么办？", "topic": "合同纠纷"})
        assert message.status_code == 200
        denied = client.post(f"/api/v1/consultations/{consultation_id}/summary", headers=auth(client_token), json={"consent": False, "scope": "需求摘要"})
        assert denied.status_code == 422
        summary = client.post(f"/api/v1/consultations/{consultation_id}/summary", headers=auth(client_token), json={"consent": True, "scope": "需求摘要"})
        assert summary.status_code == 200
        forbidden = client.get(f"/api/v1/consultations/{consultation_id}", headers=auth(lawyer_token))
        assert forbidden.status_code == 404
