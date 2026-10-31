from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from app.core.database import SessionLocal
from app.models import Order, Payment, ServiceRequest
from app.services import trade
from app.services.marketplace import expire_overdue_requests
from tests.helpers import registration_payload
from tests.test_api import auth
from tests.test_business_flow import QUOTE, REQUEST, delivered, ok, ordered, paid, parties
from tests.test_remediation import api  # noqa: F401  复用重置数据库的客户端夹具


SERVICE = {"title": "合同审查（5页内）", "service_type": "合同审阅", "field": "合同纠纷", "description": "逐条审查合同风险条款并给出修改建议", "deliverables": "合同审查意见书", "price": "299", "days": 2}


def second_lawyer(client, operator_headers, email="lawyer2@example.com"):
    session = ok(client.post("/api/v1/auth/register", json=registration_payload(client, email, "王律师", "lawyer-two-123", "lawyer")))
    headers = auth(session["access_token"])
    application = ok(client.post("/api/v1/lawyers/me/application", headers=headers, json={"firm": "正义律师事务所", "region": "上海", "field": "劳动争议", "mode": "线上服务", "license_number": f"LIC-{email}", "expires_on": "2099-01-01"}))
    ok(client.post(f"/api/v1/admin/lawyer-applications/{application['id']}/review", headers=operator_headers, json={"decision": "approve", "reason": "资质核验通过", "expected_version": application["version"]}))
    return headers, session["user"]["id"]


def test_expired_simulated_payment_is_replaced_instead_of_blocking_checkout(api):
    client_headers, lawyer_headers, _ = parties(api)
    _, _, order = ordered(api, client_headers, lawyer_headers)
    first = ok(api.post(f"/api/v1/orders/{order['id']}/payments", headers=client_headers, json={}))
    with SessionLocal.begin() as db:
        db.get(Payment, first["id"]).expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    second = ok(api.post(f"/api/v1/orders/{order['id']}/payments", headers=client_headers, json={}))
    assert second["id"] != first["id"] and second["status"] == "created"
    ok(api.post(f"/api/v1/orders/{order['id']}/payments/{second['id']}/simulate-success", headers=client_headers, json={}))
    detail = ok(api.get(f"/api/v1/orders/{order['id']}", headers=client_headers))
    assert detail["status"] == "service" and detail["service_started_at"] and detail["due_date"] == str(date.today() + timedelta(days=3))
    statuses = {item["id"]: item["status"] for item in ok(api.get(f"/api/v1/orders/{order['id']}/payments", headers=client_headers))}
    assert statuses == {first["id"]: "closed", second["id"]: "success"}


def test_lawyer_rating_ignores_reviews_received_as_a_client(api):
    client_headers, lawyer_headers, operator_headers = parties(api)
    other_headers, other_id = second_lawyer(api, operator_headers)
    # 林律师以当事人身份委托王律师，并在完成后被王律师打 1 星
    request = ok(api.post("/api/v1/requests", headers=lawyer_headers, json=REQUEST))
    quote = ok(api.post(f"/api/v1/requests/{request['id']}/quotes", headers=other_headers, json=QUOTE))
    order = ok(api.post(f"/api/v1/quotes/{quote['id']}/accept", headers=lawyer_headers))
    ok(api.post(f"/api/v1/orders/{order['id']}/confirm", headers=lawyer_headers))
    order = ok(api.post(f"/api/v1/orders/{order['id']}/confirm", headers=other_headers))
    order = paid(api, lawyer_headers, order)
    delivered(api, lawyer_headers, other_headers, order)
    ok(api.post(f"/api/v1/orders/{order['id']}/reviews", headers=other_headers, json={"rating": 1, "content": "当事人沟通不畅"}))
    ok(api.post(f"/api/v1/orders/{order['id']}/reviews", headers=lawyer_headers, json={"rating": 5}))
    lawyers = {item["id"]: item for item in ok(api.get("/api/v1/lawyers", headers=client_headers))}
    assert lawyers["L1"]["rating_avg"] is None and lawyers["L1"]["review_count"] == 0
    assert lawyers[other_id]["rating_avg"] == 5.0 and lawyers[other_id]["completed_orders"] == 1


def test_overdue_request_expires_hides_from_lawyers_and_can_be_reopened(api):
    client_headers, lawyer_headers, _ = parties(api)
    request = ok(api.post("/api/v1/requests", headers=client_headers, json={**REQUEST, "deadline": str(date.today())}))
    ok(api.post(f"/api/v1/requests/{request['id']}/quotes", headers=lawyer_headers, json=QUOTE))
    with SessionLocal.begin() as db:
        db.get(ServiceRequest, request["id"]).deadline = date.today() - timedelta(days=1)
    assert request["id"] not in {item["id"] for item in ok(api.get("/api/v1/requests", headers=lawyer_headers))}
    mine = ok(api.get(f"/api/v1/requests/{request['id']}", headers=client_headers))
    assert mine["status"] == "expired" and mine["quote_count"] == 0
    assert all(item["status"] == "expired" for item in ok(api.get(f"/api/v1/requests/{request['id']}/quotes", headers=client_headers)))
    assert api.post(f"/api/v1/requests/{request['id']}/reopen", headers=client_headers, json={"deadline": str(date.today() - timedelta(days=1))}).status_code == 422
    reopened = ok(api.post(f"/api/v1/requests/{request['id']}/reopen", headers=client_headers, json={"deadline": str(date.today() + timedelta(days=7))}))
    assert reopened["status"] == "quoting"
    ok(api.post(f"/api/v1/requests/{request['id']}/quotes", headers=lawyer_headers, json=QUOTE))
    assert ok(api.get(f"/api/v1/requests/{request['id']}", headers=client_headers))["quote_count"] == 1


def test_unanswered_delivery_is_auto_accepted_then_settled_with_platform_fee(api):
    client_headers, lawyer_headers, operator_headers = parties(api)
    _, _, order = ordered(api, client_headers, lawyer_headers)
    order = paid(api, client_headers, order)
    document = ok(api.post("/api/v1/documents", headers=lawyer_headers, json={"order_id": order["id"], "title": "审阅意见书", "doc_type": "delivery", "body": "正文"}))
    ok(api.post(f"/api/v1/orders/{order['id']}/deliveries", headers=lawyer_headers, json={"document_id": document["id"]}))
    detail = ok(api.get(f"/api/v1/orders/{order['id']}", headers=client_headers))
    assert detail["status"] == "pending_receipt" and detail["auto_accept_at"]
    with SessionLocal.begin() as db:
        assert trade.auto_accept_deliveries(db, datetime.now(timezone.utc) + timedelta(days=6)) == 0
        assert trade.auto_accept_deliveries(db, datetime.now(timezone.utc) + timedelta(days=8)) == 1
    detail = ok(api.get(f"/api/v1/orders/{order['id']}", headers=client_headers))
    assert detail["status"] == "completed" and detail["settlement_status"] == "pending" and detail["after_sales_until"]
    assert ok(api.get(f"/api/v1/orders/{order['id']}/deliveries", headers=client_headers))[0]["status"] == "accepted"
    with SessionLocal.begin() as db:
        assert trade.settle_orders(db) == 0
        assert trade.settle_orders(db, datetime.now(timezone.utc) + timedelta(days=16)) == 1
    detail = ok(api.get(f"/api/v1/orders/{order['id']}", headers=lawyer_headers))
    assert detail["settlement_status"] == "settled" and Decimal(detail["platform_fee"]) == Decimal("30.00")
    blocked = api.post(f"/api/v1/orders/{order['id']}/after-sales", headers=client_headers, json={"case_type": "refund", "reason": "结算后申请", "amount": "10"})
    assert blocked.status_code == 409
    assert ok(api.get("/api/v1/admin/settlements", headers=operator_headers))["by_status"]["settled"] == 1


def test_settlement_waits_for_pending_after_sales_case(api):
    client_headers, lawyer_headers, _ = parties(api)
    _, _, order = ordered(api, client_headers, lawyer_headers)
    order = paid(api, client_headers, order)
    delivered(api, client_headers, lawyer_headers, order)
    ok(api.post(f"/api/v1/orders/{order['id']}/after-sales", headers=lawyer_headers, json={"case_type": "dispute", "reason": "当事人拒绝沟通"}))
    with SessionLocal.begin() as db:
        assert trade.settle_orders(db, datetime.now(timezone.utc) + timedelta(days=30)) == 0
        assert db.get(Order, order["id"]).settlement_status == "frozen"


def test_service_package_purchase_creates_directed_order_hidden_from_other_lawyers(api):
    client_headers, lawyer_headers, operator_headers = parties(api)
    other_headers, _ = second_lawyer(api, operator_headers)
    service = ok(api.post("/api/v1/lawyers/me/services", headers=lawyer_headers, json=SERVICE))
    assert api.post("/api/v1/lawyers/me/services", headers=client_headers, json=SERVICE).status_code == 403
    catalog = ok(api.get("/api/v1/services", headers=client_headers))
    assert [item["id"] for item in catalog] == [service["id"]] and catalog[0]["lawyer"]["name"] == "林律师"
    assert api.post(f"/api/v1/services/{service['id']}/purchase", headers=lawyer_headers, json={"facts": "本人上架的服务不能购买", "region": "北京"}).status_code == 403
    order = ok(api.post(f"/api/v1/services/{service['id']}/purchase", headers=client_headers, json={"facts": "需要审查一份房屋租赁合同", "region": "北京"}))
    assert order["status"] == "pending_confirm" and order["lawyer_id"] == "L1" and Decimal(order["price"]) == Decimal("299.00") and order["days"] == 2
    request_id = order["request_id"]
    assert request_id not in {item["id"] for item in ok(api.get("/api/v1/requests", headers=other_headers))}
    assert api.get(f"/api/v1/requests/{request_id}", headers=other_headers).status_code == 403
    assert ok(api.get(f"/api/v1/requests/{request_id}", headers=lawyer_headers))["visibility"] == "定向委托"
    detail = ok(api.get("/api/v1/lawyers/L1", headers=client_headers))
    assert detail["services"][0]["sold"] == 1 and detail["can_take_orders"] is True
    ok(api.post(f"/api/v1/orders/{order['id']}/cancel", headers=lawyer_headers, json={"reason": "档期已满"}))
    assert ok(api.get(f"/api/v1/requests/{request_id}", headers=client_headers))["status"] == "closed"
    ok(api.put(f"/api/v1/lawyers/me/services/{service['id']}", headers=lawyer_headers, json={**SERVICE, "active": False}))
    assert ok(api.get("/api/v1/services", headers=client_headers)) == []
    assert api.post(f"/api/v1/services/{service['id']}/purchase", headers=client_headers, json={"facts": "已下架的服务不能购买", "region": "北京"}).status_code == 404


def test_invite_lawyer_notifies_once_and_my_quotes_lists_lawyer_bids(api):
    client_headers, lawyer_headers, operator_headers = parties(api)
    other_headers, other_id = second_lawyer(api, operator_headers)
    request = ok(api.post("/api/v1/requests", headers=client_headers, json=REQUEST))
    ok(api.post(f"/api/v1/requests/{request['id']}/invitations", headers=client_headers, json={"lawyer_id": other_id}))
    assert api.post(f"/api/v1/requests/{request['id']}/invitations", headers=client_headers, json={"lawyer_id": other_id}).json()["error"]["code"] == "already_invited"
    assert api.post(f"/api/v1/requests/{request['id']}/invitations", headers=lawyer_headers, json={"lawyer_id": other_id}).status_code == 403
    notices = ok(api.get("/api/v1/notifications", headers=other_headers))
    assert any(item["title"] == "当事人邀请您报价" and item["object_id"] == request["id"] for item in notices)
    ok(api.post(f"/api/v1/requests/{request['id']}/quotes", headers=other_headers, json=QUOTE))
    mine = ok(api.get("/api/v1/quotes/mine", headers=other_headers))
    assert len(mine) == 1 and mine[0]["request"]["title"] == REQUEST["title"] and mine[0]["status"] == "valid"
    assert api.get("/api/v1/quotes/mine", headers=client_headers).status_code == 403


def test_lawyer_profile_update_and_pausing_withdraws_open_quotes(api):
    client_headers, lawyer_headers, _ = parties(api)
    request = ok(api.post("/api/v1/requests", headers=client_headers, json=REQUEST))
    quote = ok(api.post(f"/api/v1/requests/{request['id']}/quotes", headers=lawyer_headers, json=QUOTE))
    profile = ok(api.put("/api/v1/lawyers/me/profile", headers=lawyer_headers, json={"bio": "专注合同与债务纠纷十余年", "practice_years": 12, "specialties": ["借贷纠纷", "公司商事", "合同纠纷"], "mode": "线上+线下", "available": False}))
    assert profile["specialties"] == ["借贷纠纷", "公司商事"] and profile["available"] is False
    assert ok(api.get(f"/api/v1/requests/{request['id']}/quotes", headers=client_headers))[0]["status"] == "withdrawn"
    assert api.post(f"/api/v1/quotes/{quote['id']}/accept", headers=client_headers).status_code == 409
    assert ok(api.get("/api/v1/lawyers?available_only=false&field=借贷纠纷", headers=client_headers))[0]["bio"] == "专注合同与债务纠纷十余年"
    ok(api.put("/api/v1/lawyers/me/profile", headers=lawyer_headers, json={"bio": "专注合同与债务纠纷十余年", "practice_years": 12, "specialties": ["借贷纠纷"], "mode": "线上服务", "available": True}))
    detail = ok(api.get("/api/v1/lawyers/L1", headers=client_headers))
    assert detail["practice_years"] == 12 and detail["can_take_orders"] is True and detail["reviews"] == []


def test_display_name_can_be_changed_and_capabilities_disclose_fees(api):
    client_headers, _, _ = parties(api)
    assert ok(api.patch("/api/v1/auth/me", headers=client_headers, json={"name": "  陈女士 "}))["name"] == "陈女士"
    assert api.patch("/api/v1/auth/me", headers=client_headers, json={"name": ""}).status_code == 422
    capabilities = ok(api.get("/api/v1/capabilities"))
    assert capabilities["platform_fee_rate"] == 0.1 and capabilities["delivery_auto_accept_days"] == 7 and capabilities["after_sales_window_days"] == 15


def test_maintenance_endpoint_is_operator_only_and_idempotent(api):
    client_headers, lawyer_headers, operator_headers = parties(api)
    assert api.post("/api/v1/admin/maintenance/run", headers=client_headers).status_code == 403
    first = ok(api.post("/api/v1/admin/maintenance/run", headers=operator_headers))
    assert set(first) == {"expired_requests", "auto_accepted", "overdue_reminded", "settled"}
    with SessionLocal.begin() as db:
        assert expire_overdue_requests(db) == 0


def test_session_refresh_extends_login_until_password_changes(api):
    client_headers, _, _ = parties(api)
    refreshed = ok(api.post("/api/v1/auth/refresh", headers=client_headers))
    assert refreshed["user"]["id"] == "C1" and refreshed["access_token"]
    new_headers = auth(refreshed["access_token"])
    ok(api.post("/api/v1/auth/password", headers=new_headers, json={"old_password": "client-demo-123", "new_password": "client-demo-456"}))
    assert api.post("/api/v1/auth/refresh", headers=new_headers).status_code == 401
    assert api.post("/api/v1/auth/refresh", headers=client_headers).status_code == 401


def test_generated_contract_states_acceptance_refund_and_platform_role(api):
    client_headers, lawyer_headers, _ = parties(api)
    _, _, order = ordered(api, client_headers, lawyer_headers, confirm=False)
    contract = ok(api.get(f"/api/v1/documents?order_id={order['id']}", headers=client_headers))[0]
    body = ok(api.get(f"/api/v1/documents/{contract['id']}", headers=client_headers))["versions"][-1]["body"]
    for clause in ("保密", "7 日内未处理的，视为验收通过", "15 日内向平台申请", "争议解决", "不是本合同的服务提供方"):
        assert clause in body
