from datetime import date, timedelta

from app.core.database import SessionLocal
from app.models import Order, Quote
from tests.test_api import auth, login
from tests.test_remediation import api  # noqa: F401  复用重置数据库的客户端夹具


REQUEST = {"title": "业务流程验证需求", "domain": "民事", "field": "合同纠纷", "service_type": "合同审阅", "facts": "对方拖欠货款，联系电话13812345678，需要律师审阅合同", "region": "北京", "budget": "500", "deadline": "2099-01-01", "deliverables": "审阅意见"}
QUOTE = {"scope": "合同审阅", "deliverables": "审阅意见书", "price": "300", "days": 3, "payment_terms": "确认后一次性支付", "valid_until": "2099-01-01"}


def parties(client):
    return auth(login(client, "client@example.com", "client-demo-123")), auth(login(client, "lawyer@example.com", "lawyer-demo-123")), auth(login(client, "operator@example.com", "operator-demo-123"))


def ok(response):
    assert response.status_code == 200, response.text
    return response.json()


def ordered(client, client_headers, lawyer_headers, confirm=True):
    request = ok(client.post("/api/v1/requests", headers=client_headers, json=REQUEST))
    quote = ok(client.post(f"/api/v1/requests/{request['id']}/quotes", headers=lawyer_headers, json=QUOTE))
    order = ok(client.post(f"/api/v1/quotes/{quote['id']}/accept", headers=client_headers))
    if confirm:
        ok(client.post(f"/api/v1/orders/{order['id']}/confirm", headers=client_headers))
        order = ok(client.post(f"/api/v1/orders/{order['id']}/confirm", headers=lawyer_headers))
    return request, quote, order


def paid(client, client_headers, order):
    payment = ok(client.post(f"/api/v1/orders/{order['id']}/payments", headers=client_headers, json={}))
    ok(client.post(f"/api/v1/orders/{order['id']}/payments/{payment['id']}/simulate-success", headers=client_headers, json={}))
    return ok(client.get(f"/api/v1/orders/{order['id']}", headers=client_headers))


def delivered(client, client_headers, lawyer_headers, order):
    document = ok(client.post("/api/v1/documents", headers=lawyer_headers, json={"order_id": order["id"], "title": "审阅意见书", "doc_type": "delivery", "body": "审阅意见正文"}))
    ok(client.post(f"/api/v1/orders/{order['id']}/deliveries", headers=lawyer_headers, json={"document_id": document["id"]}))
    return ok(client.post(f"/api/v1/orders/{order['id']}/receipt?accepted=true", headers=client_headers)), document


def test_quote_copies_terms_and_contract_confirmation_gates_payment(api):
    client_headers, lawyer_headers, _ = parties(api)
    _, _, order = ordered(api, client_headers, lawyer_headers, confirm=False)
    assert order["status"] == "pending_confirm"
    assert order["deliverables"] == "审阅意见书" and order["days"] == 3 and order["payment_terms"] == "确认后一次性支付"
    assert api.post(f"/api/v1/orders/{order['id']}/payments", headers=client_headers, json={}).status_code == 409
    ok(api.post(f"/api/v1/orders/{order['id']}/confirm", headers=lawyer_headers))
    assert api.post(f"/api/v1/orders/{order['id']}/confirm", headers=lawyer_headers).status_code == 409
    confirmed = ok(api.post(f"/api/v1/orders/{order['id']}/confirm", headers=client_headers))
    assert confirmed["status"] == "pending_payment" and confirmed["client_confirmed_at"] and confirmed["lawyer_confirmed_at"]
    contract = ok(api.get(f"/api/v1/documents?order_id={order['id']}", headers=client_headers))[0]
    assert contract["doc_type"] == "service_contract" and contract["status"] == "confirmed"


def test_cancel_unpaid_order_reopens_request_for_new_quotes(api):
    client_headers, lawyer_headers, _ = parties(api)
    request, _, order = ordered(api, client_headers, lawyer_headers)
    cancelled = ok(api.post(f"/api/v1/orders/{order['id']}/cancel", headers=client_headers, json={"reason": "改变计划"}))
    assert cancelled["status"] == "cancelled" and cancelled["closed_reason"] == "改变计划"
    assert ok(api.get(f"/api/v1/requests/{request['id']}", headers=client_headers))["status"] == "quoting"
    requote = ok(api.post(f"/api/v1/requests/{request['id']}/quotes", headers=lawyer_headers, json=QUOTE))
    second = ok(api.post(f"/api/v1/quotes/{requote['id']}/accept", headers=client_headers))
    assert second["id"] != order["id"] and second["status"] == "pending_confirm"
    assert api.post(f"/api/v1/orders/{order['id']}/cancel", headers=client_headers, json={}).status_code == 409


def test_paid_order_cannot_be_cancelled_and_delivery_requires_document(api):
    client_headers, lawyer_headers, _ = parties(api)
    _, _, order = ordered(api, client_headers, lawyer_headers)
    order = paid(api, client_headers, order)
    assert order["status"] == "service"
    assert api.post(f"/api/v1/orders/{order['id']}/cancel", headers=client_headers, json={}).status_code == 409
    assert api.post(f"/api/v1/orders/{order['id']}/deliveries", headers=lawyer_headers, json={}).status_code == 422
    contract = ok(api.get(f"/api/v1/documents?order_id={order['id']}", headers=lawyer_headers))[0]
    rejected = api.post(f"/api/v1/orders/{order['id']}/deliveries", headers=lawyer_headers, json={"document_id": contract["id"]})
    assert rejected.status_code == 422 and rejected.json()["error"]["code"] == "invalid_delivery_document"


def test_expired_quote_releases_lawyer_and_can_be_withdrawn(api):
    client_headers, lawyer_headers, _ = parties(api)
    request = ok(api.post("/api/v1/requests", headers=client_headers, json=REQUEST))
    quote = ok(api.post(f"/api/v1/requests/{request['id']}/quotes", headers=lawyer_headers, json=QUOTE))
    with SessionLocal.begin() as db:
        db.get(Quote, quote["id"]).valid_until = date.today() - timedelta(days=1)
    quotes = ok(api.get(f"/api/v1/requests/{request['id']}/quotes", headers=client_headers))
    assert quotes[0]["status"] == "expired" and quotes[0]["lawyer"]["name"] == "林律师"
    fresh = ok(api.post(f"/api/v1/requests/{request['id']}/quotes", headers=lawyer_headers, json=QUOTE))
    assert ok(api.post(f"/api/v1/quotes/{fresh['id']}/withdraw", headers=lawyer_headers))["status"] == "withdrawn"
    assert api.post(f"/api/v1/quotes/{fresh['id']}/accept", headers=client_headers).status_code == 409


def test_request_is_masked_for_lawyers_and_owner_can_edit_and_close(api):
    client_headers, lawyer_headers, _ = parties(api)
    request = ok(api.post("/api/v1/requests", headers=client_headers, json=REQUEST))
    seen = ok(api.get(f"/api/v1/requests/{request['id']}", headers=lawyer_headers))
    assert seen["masked"] and "13812345678" not in seen["facts"] and seen["owner_id"] is None
    assert "13812345678" in ok(api.get(f"/api/v1/requests/{request['id']}", headers=client_headers))["facts"]
    filtered = ok(api.get("/api/v1/requests?domain=民事&region=北京", headers=client_headers))
    assert [item["id"] for item in filtered] == [request["id"]]
    updated = ok(api.put(f"/api/v1/requests/{request['id']}", headers=client_headers, json={**{k: REQUEST[k] for k in ("title", "domain", "field", "service_type", "facts", "region", "deadline", "deliverables")}, "budget": "800", "expected_version": 1}))
    assert updated["budget"] in ("800", "800.00", 800)
    quote = ok(api.post(f"/api/v1/requests/{request['id']}/quotes", headers=lawyer_headers, json=QUOTE))
    assert ok(api.get(f"/api/v1/requests/{request['id']}", headers=lawyer_headers))["owner_id"] == "C1"
    assert ok(api.post(f"/api/v1/requests/{request['id']}/close", headers=client_headers, json={"reason": "已自行解决"}))["status"] == "closed"
    assert ok(api.get(f"/api/v1/requests/{request['id']}/quotes", headers=client_headers))[0]["id"] == quote["id"]
    assert api.post(f"/api/v1/requests/{request['id']}/quotes", headers=lawyer_headers, json=QUOTE).status_code == 409


def test_partial_refund_restores_completed_order_and_reviews(api):
    client_headers, lawyer_headers, operator_headers = parties(api)
    _, _, order = ordered(api, client_headers, lawyer_headers)
    order = paid(api, client_headers, order)
    assert api.post(f"/api/v1/orders/{order['id']}/reviews", headers=client_headers, json={"rating": 5}).status_code == 409
    completed, _ = delivered(api, client_headers, lawyer_headers, order)
    assert completed["status"] == "completed"
    ok(api.post(f"/api/v1/orders/{order['id']}/reviews", headers=client_headers, json={"rating": 4, "content": "专业高效"}))
    assert api.post(f"/api/v1/orders/{order['id']}/reviews", headers=client_headers, json={"rating": 5}).status_code == 409
    ok(api.post(f"/api/v1/orders/{order['id']}/reviews", headers=lawyer_headers, json={"rating": 5}))
    lawyer = next(item for item in ok(api.get("/api/v1/lawyers", headers=client_headers)) if item["id"] == "L1")
    assert lawyer["rating_avg"] == 4.0 and lawyer["review_count"] == 1 and lawyer["completed_orders"] == 1

    case = ok(api.post(f"/api/v1/orders/{order['id']}/after-sales", headers=client_headers, json={"case_type": "refund", "reason": "部分内容未覆盖", "amount": "100"}))
    ok(api.post(f"/api/v1/admin/cases/{case['id']}/resolve", headers=operator_headers, json={"decision": "approve", "resolution": "同意部分退款"}))
    after = ok(api.get(f"/api/v1/orders/{order['id']}", headers=client_headers))
    assert after["status"] == "completed" and after["settlement_status"] == "partially_refunded"


def test_dispute_outcomes_and_lawyer_can_open_dispute(api):
    client_headers, lawyer_headers, operator_headers = parties(api)
    _, _, order = ordered(api, client_headers, lawyer_headers)
    order = paid(api, client_headers, order)
    assert api.post(f"/api/v1/orders/{order['id']}/after-sales", headers=lawyer_headers, json={"case_type": "refund", "reason": "律师不能退款", "amount": "1"}).status_code == 403
    dispute = ok(api.post(f"/api/v1/orders/{order['id']}/after-sales", headers=lawyer_headers, json={"case_type": "dispute", "reason": "当事人拒绝提供材料"}))
    assert ok(api.get(f"/api/v1/orders/{order['id']}", headers=client_headers))["status"] == "disputed"
    ok(api.post(f"/api/v1/admin/cases/{dispute['id']}/resolve", headers=operator_headers, json={"decision": "reject", "resolution": "继续履约"}))
    assert ok(api.get(f"/api/v1/orders/{order['id']}", headers=client_headers))["status"] == "service"

    second = ok(api.post(f"/api/v1/orders/{order['id']}/after-sales", headers=client_headers, json={"case_type": "dispute", "reason": "服务质量争议"}))
    ok(api.post(f"/api/v1/admin/cases/{second['id']}/resolve", headers=operator_headers, json={"decision": "complete", "resolution": "双方协商一致完成订单"}))
    finished = ok(api.get(f"/api/v1/orders/{order['id']}", headers=client_headers))
    assert finished["status"] == "completed" and finished["settlement_status"] == "pending"

    third = ok(api.post(f"/api/v1/orders/{order['id']}/after-sales", headers=client_headers, json={"case_type": "dispute", "reason": "要求退款"}))
    resolved = ok(api.post(f"/api/v1/admin/cases/{third['id']}/resolve", headers=operator_headers, json={"decision": "approve", "resolution": "支持全额退款", "amount": "300"}))
    assert resolved["status"] == "approved"
    closed = ok(api.get(f"/api/v1/orders/{order['id']}", headers=client_headers))
    assert closed["status"] == "closed" and closed["settlement_status"] == "refunded"


def test_after_sales_window_closes(api):
    client_headers, lawyer_headers, _ = parties(api)
    _, _, order = ordered(api, client_headers, lawyer_headers)
    order = paid(api, client_headers, order)
    delivered(api, client_headers, lawyer_headers, order)
    with SessionLocal.begin() as db:
        db.get(Order, order["id"]).completed_at = db.get(Order, order["id"]).completed_at - timedelta(days=30)
    late = api.post(f"/api/v1/orders/{order['id']}/after-sales", headers=client_headers, json={"case_type": "refund", "reason": "超期申请", "amount": "1"})
    assert late.status_code == 409 and late.json()["error"]["code"] == "after_sales_expired"


def test_evidence_package_contains_hashes_and_is_audited(api):
    client_headers, lawyer_headers, operator_headers = parties(api)
    _, _, order = ordered(api, client_headers, lawyer_headers)
    order = paid(api, client_headers, order)
    _, document = delivered(api, client_headers, lawyer_headers, order)
    package = ok(api.get(f"/api/v1/orders/{order['id']}/evidence", headers=client_headers))
    assert len(package["package_sha256"]) == 64
    assert package["order"]["status"] == "completed" and package["payments"][0]["status"] == "success"
    delivered_doc = next(item for item in package["documents"] if item["id"] == document["id"])
    assert len(delivered_doc["versions"][0]["sha256"]) == 64
    assert any(item["action"] == "quote.accepted" for item in package["audit_log"])
    audit = ok(api.get("/api/v1/admin/audit?action=order.evidence", headers=operator_headers))
    assert audit and audit[0]["actor_name"] == "陈先生"


def test_document_restore_resolve_comment_and_withdraw_workflow(api):
    client_headers, lawyer_headers, _ = parties(api)
    _, _, order = ordered(api, client_headers, lawyer_headers)
    order = paid(api, client_headers, order)
    document = ok(api.post("/api/v1/documents", headers=lawyer_headers, json={"order_id": order["id"], "title": "起诉状", "body": "第一版"}))
    ok(api.post(f"/api/v1/documents/{document['id']}/versions", headers=lawyer_headers, json={"body": "第二版", "base_version": 1}))
    restored = ok(api.post(f"/api/v1/documents/{document['id']}/versions/1/restore", headers=lawyer_headers))
    assert restored["number"] == 3
    assert ok(api.get(f"/api/v1/documents/{document['id']}/versions/3", headers=client_headers))["body"] == "第一版"
    comment = ok(api.post(f"/api/v1/documents/{document['id']}/comments", headers=client_headers, json={"version": 3, "text": "请补充诉讼请求"}))
    detail = ok(api.get(f"/api/v1/documents/{document['id']}", headers=lawyer_headers))
    assert detail["comments"][0]["author_name"] == "陈先生" and not detail["comments"][0]["resolved"]
    assert ok(api.post(f"/api/v1/documents/{document['id']}/comments/{comment['id']}/resolve", headers=lawyer_headers))["resolved"]
    ok(api.post(f"/api/v1/documents/{document['id']}/workflow", headers=lawyer_headers, json={"assignee_ids": ["C1"]}))
    assert api.post(f"/api/v1/documents/{document['id']}/workflow/withdraw", headers=client_headers).status_code == 403
    withdrawn = ok(api.post(f"/api/v1/documents/{document['id']}/workflow/withdraw", headers=lawyer_headers))
    assert withdrawn["status"] == "returned" and withdrawn["workflow"][0]["status"] == "withdrawn"


def test_consultation_category_intake_and_sticky_risk(api):
    client_headers, _, _ = parties(api)
    created = ok(api.post("/api/v1/consultations", headers=client_headers, json={"topic": "刑事问题", "category": "criminal", "intake": {"coercive_measure": "已被刑事拘留", "location": "上海"}}))
    assert created["category"] == "criminal" and created["risk_level"] == "high" and created["intake"]["location"] == "上海"
    civil = ok(api.post("/api/v1/consultations", headers=client_headers, json={"topic": "合同纠纷", "category": "civil"}))
    ok(api.post(f"/api/v1/consultations/{civil['id']}/messages", headers=client_headers, json={"prompt": "对方转移财产怎么办，涉及财产转移", "topic": "合同纠纷"}))
    ok(api.post(f"/api/v1/consultations/{civil['id']}/messages", headers=client_headers, json={"prompt": "合同怎么写比较好", "topic": "另一个领域"}))
    detail = ok(api.get(f"/api/v1/consultations/{civil['id']}", headers=client_headers))
    assert detail["risk_level"] == "high" and detail["topic"] == "合同纠纷"
    # Test category filtering
    all_consultations = ok(api.get("/api/v1/consultations", headers=client_headers))
    assert len(all_consultations) >= 2
    criminal_only = ok(api.get("/api/v1/consultations?category=criminal", headers=client_headers))
    assert all(c["category"] == "criminal" for c in criminal_only)
    assert any(c["id"] == created["id"] for c in criminal_only)
    civil_only = ok(api.get("/api/v1/consultations?category=civil", headers=client_headers))
    assert all(c["category"] == "civil" for c in civil_only)
    assert any(c["id"] == civil["id"] for c in civil_only)
    # Test risk level filtering
    high_risk = ok(api.get("/api/v1/consultations?risk_level=high", headers=client_headers))
    assert all(c["risk_level"] == "high" for c in high_risk)
    assert len(high_risk) >= 2  # Both created and civil should be high risk


def test_admin_metrics_and_unfreeze(api):
    client_headers, lawyer_headers, operator_headers = parties(api)
    _, _, order = ordered(api, client_headers, lawyer_headers)
    paid(api, client_headers, order)
    metrics = ok(api.get("/api/v1/admin/metrics", headers=operator_headers))
    assert metrics["funnel"]["requests"] == 1 and metrics["funnel"]["paid"] == 1 and metrics["payment_success_rate"] == 1
    assert api.get("/api/v1/admin/metrics", headers=client_headers).status_code == 403
    ok(api.post("/api/v1/admin/lawyers/L1/freeze", headers=operator_headers, json={"reason": "资质复核"}))
    notices = ok(api.get("/api/v1/notifications", headers=client_headers))
    assert any(item["title"] == "承办律师接单权限已暂停" for item in notices)
    assert ok(api.post("/api/v1/admin/lawyers/L1/unfreeze", headers=operator_headers, json={"reason": "复核通过"}))["status"] == "approved"
