import base64

from fastapi.testclient import TestClient

from app.api import chats
from app.core.database import SessionLocal
from app.main import app
from app.models import Consent, ConsultationFeedback, ConsultationMessage
from tests.helpers import registration_payload
from tests.test_api import auth, login, reset_database


def register(client, email, name):
    response = client.post("/api/v1/auth/register", json=registration_payload(client, email, name, "chat-test-pass-123"))
    assert response.status_code == 200, response.text
    return response.json()["access_token"], response.json()["user"]["id"]


def publish_and_quote(client, client_token, lawyer_token):
    request = client.post("/api/v1/requests", headers=auth(client_token), json={"title": "交流测试需求", "domain": "民事", "field": "合同纠纷", "service_type": "合同审阅", "facts": "需要审阅采购合同的付款条款。", "region": "北京", "budget": "1000", "deadline": "2099-01-01", "deliverables": "审阅意见", "visibility": "认证律师可见"})
    assert request.status_code == 200, request.text
    quote = client.post(f"/api/v1/requests/{request.json()['id']}/quotes", headers=auth(lawyer_token), json={"scope": "审阅", "deliverables": "意见", "price": "800", "days": 2, "valid_until": "2099-01-01"})
    assert quote.status_code == 200, quote.text


def test_chat_permissions_messages_and_unread():
    reset_database()
    with TestClient(app) as client:
        client_token = login(client, "client@example.com", "client-demo-123")
        lawyer_token = login(client, "lawyer@example.com", "lawyer-demo-123")
        operator_token = login(client, "operator@example.com", "operator-demo-123")
        stranger_token, stranger_id = register(client, "chat-stranger@example.test", "旁观用户")

        assert client.post("/api/v1/chats", headers=auth(client_token), json={"peer_id": "A1"}).status_code == 403
        assert client.post("/api/v1/chats", headers=auth(operator_token), json={"peer_id": "C1"}).status_code == 403
        assert client.post("/api/v1/chats", headers=auth(lawyer_token), json={"peer_id": stranger_id}).status_code == 403
        assert client.post("/api/v1/chats", headers=auth(lawyer_token), json={"peer_id": "C1"}).status_code == 403

        opened = client.post("/api/v1/chats", headers=auth(client_token), json={"peer_id": "L1"})
        assert opened.status_code == 200, opened.text
        conversation = opened.json()
        assert conversation["peer"]["name"] == "林律师" and conversation["my_side"] == "client"
        assert client.post("/api/v1/chats", headers=auth(client_token), json={"peer_id": "L1"}).json()["id"] == conversation["id"]

        publish_and_quote(client, client_token, lawyer_token)
        from_lawyer = client.post("/api/v1/chats", headers=auth(lawyer_token), json={"peer_id": "C1"})
        assert from_lawyer.status_code == 200 and from_lawyer.json()["id"] == conversation["id"]

        path = f"/api/v1/chats/{conversation['id']}"
        assert client.post(f"{path}/messages", headers=auth(client_token), json={"text": "   "}).status_code == 422
        assert client.post(f"{path}/messages", headers=auth(client_token), json={"text": "律师您好，想咨询合同问题"}).status_code == 200
        assert client.post(f"{path}/messages", headers=auth(client_token), json={"text": "附件稍后上传"}).status_code == 200
        assert client.get(f"{path}/messages", headers=auth(stranger_token)).status_code == 404
        assert client.post(f"{path}/messages", headers=auth(stranger_token), json={"text": "越权"}).status_code == 404

        assert client.get("/api/v1/chats/unread-count", headers=auth(lawyer_token)).json() == {"unread": 2}
        assert client.get("/api/v1/chats/unread-count", headers=auth(client_token)).json() == {"unread": 0}
        listed = client.get("/api/v1/chats", headers=auth(lawyer_token)).json()
        assert listed[0]["unread"] == 2 and listed[0]["last_message"]["text"] == "附件稍后上传"
        history = client.get(f"{path}/messages", headers=auth(lawyer_token)).json()
        assert [item["text"] for item in history] == ["律师您好，想咨询合同问题", "附件稍后上传"]
        assert client.post(f"{path}/read", headers=auth(lawyer_token)).status_code == 200
        assert client.get("/api/v1/chats/unread-count", headers=auth(lawyer_token)).json() == {"unread": 0}
        assert client.get("/api/v1/chats", headers=auth(stranger_token)).json() == []


def test_chat_stream_delivers_messages(monkeypatch):
    reset_database()
    monkeypatch.setattr(chats, "STREAM_LIFETIME_SECONDS", 2)
    with TestClient(app) as client:
        client_token = login(client, "client@example.com", "client-demo-123")
        lawyer_token = login(client, "lawyer@example.com", "lawyer-demo-123")
        conversation = client.post("/api/v1/chats", headers=auth(client_token), json={"peer_id": "L1"}).json()
        sent = client.post(f"/api/v1/chats/{conversation['id']}/messages", headers=auth(client_token), json={"text": "实时消息"}).json()
        events = []
        with client.stream("GET", "/api/v1/chats/stream?since=2000-01-01T00:00:00Z", headers=auth(lawyer_token)) as response:
            assert response.status_code == 200
            assert response.headers["content-type"].startswith("text/event-stream")
            for line in response.iter_lines():
                if line.startswith("event:"):
                    events.append(line[6:].strip())
                if line.startswith("data:") and events[-1] == "message":
                    assert sent["id"] in line and "实时消息" in line
        assert events[0] == "ready" and events.count("message") == 1 and events[-1] == "reconnect"


def test_consultation_delete_keeps_consent():
    reset_database()
    with TestClient(app) as client:
        client_token = login(client, "client@example.com", "client-demo-123")
        lawyer_token = login(client, "lawyer@example.com", "lawyer-demo-123")
        created = client.post("/api/v1/consultations", headers=auth(client_token), json={"topic": "合同问题", "title": "待删除咨询"}).json()
        answered = client.post(f"/api/v1/consultations/{created['id']}/messages", headers=auth(client_token), json={"prompt": "合同对方迟迟不交货，应该怎么办？", "topic": "合同问题"})
        assert answered.status_code == 200, answered.text
        assistant = next(item for item in answered.json()["messages"] if item["role"] == "assistant")
        assert client.post(f"/api/v1/consultations/{created['id']}/feedback", headers=auth(client_token), json={"message_id": assistant["id"], "value": "有用"}).status_code == 200
        assert client.post(f"/api/v1/consultations/{created['id']}/summary", headers=auth(client_token), json={"consent": True, "scope": "咨询转服务需求"}).status_code == 200

        assert client.delete(f"/api/v1/consultations/{created['id']}", headers=auth(lawyer_token)).status_code == 404
        deleted = client.delete(f"/api/v1/consultations/{created['id']}", headers=auth(client_token))
        assert deleted.status_code == 200 and deleted.json()["deleted"] is True
        assert client.get(f"/api/v1/consultations/{created['id']}", headers=auth(client_token)).status_code == 404
        assert all(item["id"] != created["id"] for item in client.get("/api/v1/consultations", headers=auth(client_token)).json())
        db = SessionLocal()
        try:
            assert db.query(ConsultationMessage).filter_by(consultation_id=created["id"]).count() == 0
            assert db.query(ConsultationFeedback).filter_by(consultation_id=created["id"]).count() == 0
            assert db.query(Consent).filter_by(source_id=created["id"]).count() == 1
        finally:
            db.close()


def test_avatar_validation_and_round_trip():
    reset_database()
    with TestClient(app) as client:
        token = login(client, "client@example.com", "client-demo-123")
        image = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\nfake-image").decode()
        assert client.post("/api/v1/auth/avatar", headers=auth(token), json={"data_url": "data:text/html;base64,PGI+"}).status_code == 422
        assert client.post("/api/v1/auth/avatar", headers=auth(token), json={"data_url": "data:image/png;base64,***"}).status_code == 422
        oversized = "data:image/png;base64," + base64.b64encode(b"x" * (200 * 1024 + 1)).decode()
        assert client.post("/api/v1/auth/avatar", headers=auth(token), json={"data_url": oversized}).status_code == 422
        saved = client.post("/api/v1/auth/avatar", headers=auth(token), json={"data_url": image})
        assert saved.status_code == 200 and saved.json()["avatar"] == image
        assert client.get("/api/v1/auth/me", headers=auth(token)).json()["avatar"] == image
        assert client.post("/api/v1/chats", headers=auth(token), json={"peer_id": "L1"}).status_code == 200
        lawyer_token = login(client, "lawyer@example.com", "lawyer-demo-123")
        assert client.get("/api/v1/chats", headers=auth(lawyer_token)).json()[0]["peer"]["avatar"] == image
        assert client.post("/api/v1/auth/avatar", headers=auth(token), json={"data_url": None}).json()["avatar"] is None


def test_chat_attachments_shared_only_inside_conversation():
    reset_database()
    with TestClient(app) as client:
        client_token = login(client, "client@example.com", "client-demo-123")
        lawyer_token = login(client, "lawyer@example.com", "lawyer-demo-123")
        stranger_token, _ = register(client, "chat-file-stranger@example.test", "旁观用户")
        conversation = client.post("/api/v1/chats", headers=auth(client_token), json={"peer_id": "L1"}).json()
        path = f"/api/v1/chats/{conversation['id']}"
        assert client.post(f"{path}/messages", headers=auth(client_token), json={"text": ""}).status_code == 422
        uploaded = client.post("/api/v1/files", headers=auth(client_token), files={"file": ("合同.pdf", b"%PDF-1.4 chat file", "application/pdf")}).json()
        assert client.post(f"{path}/messages", headers=auth(lawyer_token), json={"file_id": uploaded["id"]}).status_code == 403
        sent = client.post(f"{path}/messages", headers=auth(client_token), json={"text": "请查看附件", "file_id": uploaded["id"]})
        assert sent.status_code == 200, sent.text
        assert sent.json()["attachment"] == {"file_id": uploaded["id"], "name": "合同.pdf", "size": 18, "content_type": "application/pdf"}
        only_file = client.post(f"{path}/messages", headers=auth(client_token), json={"file_id": uploaded["id"]})
        assert only_file.status_code == 200 and only_file.json()["text"] == ""
        downloaded = client.get(f"{path}/files/{uploaded['id']}", headers=auth(lawyer_token))
        assert downloaded.status_code == 200 and downloaded.content == b"%PDF-1.4 chat file"
        assert client.get(f"{path}/files/{uploaded['id']}", headers=auth(stranger_token)).status_code == 404
        other = client.post("/api/v1/files", headers=auth(client_token), files={"file": ("其他.txt", b"other", "text/plain")}).json()
        assert client.get(f"{path}/files/{other['id']}", headers=auth(lawyer_token)).status_code == 404
        assert client.get(f"{path}/messages", headers=auth(lawyer_token)).json()[0]["attachment"]["name"] == "合同.pdf"


def test_schema_revision_constants_match_migration_head():
    from pathlib import Path

    from alembic.config import Config
    from alembic.script import ScriptDirectory

    from app.services.health import SCHEMA_REVISION

    root = Path(__file__).resolve().parents[1]
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "migrations"))
    head = ScriptDirectory.from_config(config).get_current_head()
    assert SCHEMA_REVISION == head
    assert f'== "{head}"' in (root / "scripts" / "manage.py").read_text()
