import pytest

from app.core.database import SessionLocal
from app.models import ServiceRequest, StoredFile
from tests.helpers import registration_payload
from tests.test_api import auth
from tests.test_business_flow import QUOTE, REQUEST, ok, parties
from tests.test_remediation import api


def upload(api, headers, name="聊天记录.txt", content=b"chat log", **data):
    return ok(api.post("/api/v1/files", headers=headers, files={"file": (name, content, "text/plain")}, data=data))


def test_request_upload_persists_metadata_and_owner_download(api):
    client, _, _ = parties(api)
    stored = upload(api, client)
    payload = {**REQUEST, "attachment_file_ids": [stored["id"]]}
    headers = {**client, "Idempotency-Key": "request-attachment-create"}
    created = ok(api.post("/api/v1/requests", headers=headers, json=payload))
    repeated = ok(api.post("/api/v1/requests", headers=headers, json=payload))
    assert repeated["id"] == created["id"]
    detail = ok(api.get(f"/api/v1/requests/{created['id']}", headers=client))
    assert detail["attachment_count"] == 1
    assert detail["attachments"] == [{"file_id": stored["id"], "name": "聊天记录.txt", "size": 8, "content_type": "text/plain"}]
    assert "storage_path" not in str(detail)
    with SessionLocal() as db:
        assert db.get(ServiceRequest, created["id"]).attachments_json == detail["attachments"]
    downloaded = api.get(f"/api/v1/requests/{created['id']}/files/{stored['id']}", headers=client)
    assert downloaded.status_code == 200 and downloaded.content == b"chat log"
    assert downloaded.headers["cache-control"] == "private, no-store"
    assert "attachment" in downloaded.headers["content-disposition"]


def test_request_attachments_are_hidden_until_order_and_revoked_on_cancel(api):
    client, lawyer, operator = parties(api)
    stored = upload(api, client, name="私密证据.txt")
    request = ok(api.post("/api/v1/requests", headers=client, json={**REQUEST, "attachment_file_ids": [stored["id"]]}))
    endpoint = f"/api/v1/requests/{request['id']}/files/{stored['id']}"
    for headers in (lawyer, operator):
        detail = ok(api.get(f"/api/v1/requests/{request['id']}", headers=headers))
        assert detail["attachment_count"] == 1 and detail["attachments"] == []
        assert "私密证据" not in str(detail) and stored["id"] not in str(detail)
        listing = ok(api.get("/api/v1/requests", headers=headers))
        assert listing[0]["attachments"] == []
        assert api.get(endpoint, headers=headers).status_code == 403
    quote = ok(api.post(f"/api/v1/requests/{request['id']}/quotes", headers=lawyer, json=QUOTE))
    assert api.get(endpoint, headers=lawyer).status_code == 403
    order = ok(api.post(f"/api/v1/quotes/{quote['id']}/accept", headers=client))
    assert api.get(endpoint, headers=lawyer).content == b"chat log"
    assert ok(api.get(f"/api/v1/requests/{request['id']}", headers=lawyer))["attachments"][0]["file_id"] == stored["id"]
    assert api.get(f"/api/v1/files/{stored['id']}", headers=lawyer).status_code == 403
    ok(api.post(f"/api/v1/orders/{order['id']}/cancel", headers=client, json={"reason": "取消测试委托"}))
    assert api.get(endpoint, headers=lawyer).status_code == 403


@pytest.mark.parametrize("kind", ["missing", "foreign", "duplicate", "unavailable", "document", "too_many"])
def test_invalid_request_attachments_are_rejected_atomically(api, kind):
    client, lawyer, _ = parties(api)
    stored = upload(api, client)
    if kind == "missing":
        file_ids = ["nonexistent-file"]
    elif kind == "foreign":
        file_ids = [upload(api, lawyer)["id"]]
    elif kind == "duplicate":
        file_ids = [stored["id"], stored["id"]]
    elif kind == "too_many":
        file_ids = [stored["id"]] * 9
    else:
        with SessionLocal.begin() as db:
            if kind == "document":
                db.get(StoredFile, stored["id"]).document_id = "controlled-document"
            else:
                db.get(StoredFile, stored["id"]).status = "quarantined"
        file_ids = [stored["id"]]
    result = api.post("/api/v1/requests", headers=client, json={**REQUEST, "attachment_file_ids": file_ids})
    assert result.status_code == 422, result.text
    with SessionLocal() as db:
        assert db.query(ServiceRequest).count() == 0


def test_unrelated_request_or_client_cannot_access_attachment(api):
    client, _, _ = parties(api)
    stored = upload(api, client)
    request = ok(api.post("/api/v1/requests", headers=client, json={**REQUEST, "attachment_file_ids": [stored["id"]]}))
    unrelated = ok(api.post("/api/v1/requests", headers=client, json=REQUEST))
    assert unrelated["attachments"] == [] and unrelated["attachment_count"] == 0
    assert api.get(f"/api/v1/requests/{unrelated['id']}/files/{stored['id']}", headers=client).status_code == 404
    registered = ok(api.post("/api/v1/auth/register", json=registration_payload(api, "another-client@example.test", "另一当事人", "test-client-password")))
    endpoint = f"/api/v1/requests/{request['id']}/files/{stored['id']}"
    assert api.get(endpoint, headers=auth(registered["access_token"])).status_code == 403
    assert api.get(endpoint).status_code == 401
