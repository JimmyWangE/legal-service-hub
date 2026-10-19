from datetime import datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import json

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import DomainError, require
from app.models import AfterSalesCase, Order, Payment, PaymentTransaction, PaymentWebhookInbox, Refund, User
from app.services.common import commit_event, money, new_id, notify, record_audit, stable_hash
from app.services.payment_provider import get_payment_provider


def semantic_event(event):
    return {key: value for key, value in event.items() if key != "requires_query"}


def validate_event(db, event):
    require(event.get("status") in {"success", "failed", "closed", "pending"}, "通知状态无效", 422, "invalid_payment_event")
    for name in ("event_id", "transaction_id", "intent_id", "merchant_id"):
        require(isinstance(event.get(name), str) and 0 < len(event[name]) <= 150, "通知标识无效", 422, "invalid_payment_event")
    try:
        amount = Decimal(event["amount"])
        require(amount.is_finite() and amount > 0 and amount == money(amount), "金额精度无效", 422, "invalid_amount")
    except (ArithmeticError, ValueError, TypeError) as exc:
        raise DomainError("金额无效", 422, "invalid_amount") from exc
    event["amount"] = str(money(amount))
    payment = db.query(Payment).filter_by(intent_id=event["intent_id"]).first()
    require(payment is not None, "支付单不存在", 404, "not_found")
    require(payment.provider == event["provider"] and payment.merchant_id == event["merchant_id"], "支付渠道或商户不匹配", 409, "provider_mismatch")
    require(payment.amount == amount and event["currency"] == "CNY", "支付金额或币种不匹配", 422, "amount_mismatch")
    return payment


def receive_event(db: Session, raw: bytes, event: dict):
    validate_event(db, event)
    identity = {name: event[name] for name in ("provider", "merchant_id", "event_id")}
    existing = db.query(PaymentWebhookInbox).filter_by(**identity).first()
    if existing:
        require(semantic_event(existing.event_json) == semantic_event(event), "同一事件包含冲突内容", 409, "payment_event_conflict")
        return existing
    inbox = PaymentWebhookInbox(id=new_id(), **identity, body_hash=hashlib.sha256(raw).hexdigest(), event_json=event)
    try:
        with db.begin_nested():
            db.add(inbox)
            db.flush()
    except IntegrityError:
        existing = db.query(PaymentWebhookInbox).filter_by(**identity).one()
        require(semantic_event(existing.event_json) == semantic_event(event), "同一事件包含冲突内容", 409, "payment_event_conflict")
        return existing
    commit_event(db, "payment.notification.accepted", "payment_inbox", inbox.id, {"provider": inbox.provider})
    return inbox


def simulate_success(db: Session, actor: User, order_id: str, payment_id: str, request_id: str = "") -> Payment:
    order = db.query(Order).filter_by(id=order_id).with_for_update().first()
    require(order is not None, "订单不存在", 404, "not_found")
    require(actor.has_role("operator") or actor.id in (order.client_id, order.lawyer_id), "无权访问此订单", 403, "forbidden")
    require(actor.id == order.client_id, "只有当事人可以模拟支付", 403, "forbidden")

    payment = db.query(Payment).filter_by(id=payment_id, order_id=order.id).with_for_update().first()
    require(payment is not None, "支付单不存在", 404, "not_found")
    provider = get_payment_provider("stub")
    require(payment.provider == provider.name, "当前支付单不是模拟支付单", 409, "payment_provider_mismatch")
    if payment.status == "success":
        return payment
    require(payment.status in {"created", "pending"}, "支付单当前不可模拟支付", 409, "invalid_state")
    if payment.expires_at:
        expires_at = payment.expires_at.replace(tzinfo=timezone.utc)
        require(expires_at > datetime.now(timezone.utc), "模拟支付单已过期", 409, "payment_expired")

    event = {
        "provider": provider.name,
        "merchant_id": provider.merchant_id,
        "event_id": f"simulated-{payment.intent_id}",
        "intent_id": payment.intent_id,
        "transaction_id": f"simulated-{payment.intent_id}",
        "status": "success",
        "amount": str(payment.amount),
        "currency": "CNY",
    }
    raw = json.dumps(event, ensure_ascii=False, separators=(",", ":")).encode()
    inbox = receive_event(db, raw, event)
    if inbox.status != "processed":
        book_event(db, event)
        inbox.status = "processed"
        inbox.processed_at = datetime.now(timezone.utc)
        inbox.attempts += 1
    record_audit(db, actor, "payment.simulated", "payment", payment.id, {"amount": str(payment.amount)}, request_id)
    db.flush()
    db.refresh(payment)
    return payment


def locked_payment(db, intent_id):
    located = db.query(Payment).filter_by(intent_id=intent_id).first()
    require(located is not None, "支付单不存在", 404, "not_found")
    order = db.query(Order).filter_by(id=located.order_id).with_for_update().one()
    payment = db.query(Payment).filter_by(id=located.id).with_for_update().populate_existing().one()
    return order, payment


def book_event(db, event):
    order, payment = locked_payment(db, event["intent_id"])
    validate_event(db, event)
    if event.get("requires_query"):
        actual = get_payment_provider(payment.provider).query(payment)
        require(actual.get("status") == event["status"] and actual.get("transaction_id") == event["transaction_id"] and money(actual["amount"]) == payment.amount, "延迟通知查单未确认", 503, "payment_query_unconfirmed")
    if event["status"] != "success":
        if payment.status != "success" and event["status"] in {"closed", "failed"}:
            payment.status = event["status"]
        return
    duplicate = db.query(PaymentTransaction).filter_by(provider=payment.provider, merchant_id=payment.merchant_id, transaction_id=event["transaction_id"]).first()
    if duplicate:
        require(duplicate.payment_id == payment.id and duplicate.amount == payment.amount, "渠道交易重复关联", 409, "payment_transaction_conflict")
        return
    ledger = PaymentTransaction(id=new_id(), payment_id=payment.id, provider=payment.provider, merchant_id=payment.merchant_id, transaction_id=event["transaction_id"], amount=payment.amount)
    db.add(ledger)
    overpayment = payment.status == "success" or order.payment_status == "paid"
    payment.transaction_id = event["transaction_id"] if not overpayment else payment.transaction_id
    payment.status = "success"
    payment.provider_event_id = payment.provider_event_id or event["event_id"]
    if overpayment:
        ledger.status = "overpayment_review"
        commit_event(db, "payment.overpayment_review", "payment", payment.id, {"transaction_id": event["transaction_id"]})
    else:
        order.paid = money(order.paid) + payment.amount
        order.payment_status = "paid"
        order.status = "service" if order.status == "pending_payment" else order.status
        order.version += 1
        notify(db, order.client_id, "支付已确认", "资金状态已由支付机构确认", "order", order.id)
        notify(db, order.lawyer_id, "订单已支付", "订单可以开始履约", "order", order.id)
    record_audit(db, None, "payment.booked", "payment", payment.id, {"amount": str(payment.amount), "overpayment": overpayment})
    commit_event(db, "payment.success", "order", order.id, {"payment_id": payment.id})


def process_inbox_once(db, inbox_id=None):
    query = db.query(PaymentWebhookInbox).filter(PaymentWebhookInbox.status.in_(["pending", "retry"]), PaymentWebhookInbox.next_attempt_at <= datetime.now(timezone.utc))
    if inbox_id:
        query = query.filter_by(id=inbox_id)
    item = query.order_by(PaymentWebhookInbox.created_at).with_for_update(skip_locked=True).first()
    if not item:
        return False
    book_event(db, item.event_json)
    item.status = "processed"
    item.processed_at = datetime.now(timezone.utc)
    item.attempts += 1
    db.flush()
    return True


def synchronize_payment(db, payment_id):
    located = db.get(Payment, payment_id)
    order, payment = locked_payment(db, located.intent_id)
    provider = get_payment_provider(payment.provider)
    if payment.status == "creating":
        actual = provider.query(payment) if payment.attempts else {"status": "pending"}
        if actual["status"] == "success":
            book_event(db, {"provider": payment.provider, "merchant_id": payment.merchant_id, "event_id": "query-" + stable_hash(actual["transaction_id"]), "intent_id": payment.intent_id, **actual})
        elif actual["status"] == "closed":
            payment.status = "closed"
        elif payment.expires_at.replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc):
            provider.close(payment)
            payment.status = "closed"
        else:
            payment.client_params = provider.create_intent(payment, order.title)
            payment.status = "created"
    elif payment.status == "created":
        actual = provider.query(payment)
        if actual["status"] == "success":
            book_event(db, {"provider": payment.provider, "merchant_id": payment.merchant_id, "event_id": "query-" + stable_hash(actual["transaction_id"]), "intent_id": payment.intent_id, **actual})
        elif actual["status"] == "closed":
            payment.status = "closed"
        elif payment.expires_at.replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc):
            provider.close(payment)
            payment.status = "closed"
    payment.attempts += 1
    payment.next_attempt_at = datetime.now(timezone.utc) + timedelta(seconds=15)


def synchronize_refund(db, refund_id):
    located = db.get(Refund, refund_id)
    payment_location = db.get(Payment, located.payment_id)
    order, payment = locked_payment(db, payment_location.intent_id)
    refund = db.query(Refund).filter_by(id=refund_id).with_for_update().populate_existing().one()
    if refund.status == "success":
        return
    provider = get_payment_provider(payment.provider)
    reference, completed = provider.query_refund(refund, payment) if refund.status == "processing" else provider.refund(refund, payment)
    refund.provider_refund_id = reference
    refund.status = "success" if completed else "processing"
    refund.attempts += 1
    refund.next_attempt_at = datetime.now(timezone.utc) + timedelta(seconds=30)
    if completed:
        payment.refunded = money(payment.refunded) + refund.amount
        require(payment.refunded <= payment.amount, "累计退款超出支付金额", 409, "refund_exceeds_payment")
        order.status = "closed" if payment.refunded == order.paid else "service"
        order.settlement_status = "refunded" if payment.refunded == order.paid else "partially_refunded"
        order.version += 1
        if refund.case_id:
            case = db.get(AfterSalesCase, refund.case_id)
            case.status = "approved"
        notify(db, order.client_id, "退款已确认", f"支付机构已确认退款{refund.amount}元", "order", order.id)
        record_audit(db, None, "refund.success", "refund", refund.id, {"amount": str(refund.amount)})
        commit_event(db, "refund.success", "refund", refund.id, {"order_id": order.id})
