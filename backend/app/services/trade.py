from decimal import Decimal
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy.orm import Session

from app.core.errors import DomainError, require
from app.models import AfterSalesCase, Delivery, Document, Order, Payment, Refund, User
from app.schemas import AfterSalesCreate, DeliveryCreate, PaymentCreate, PaymentWebhook
from app.services.common import commit_event, money, new_id, notify, record_audit
from app.services.payment_provider import get_payment_provider


def get_order(db: Session, user: User, order_id: str, lock: bool = False) -> Order:
    query = db.query(Order).filter(Order.id == order_id)
    if lock:
        query = query.with_for_update()
    order = query.first()
    require(order is not None, "订单不存在", 404, "not_found")
    require(user.has_role("operator") or user.id in (order.client_id, order.lawyer_id), "无权访问此订单", 403, "forbidden")
    return order


def create_payment(db: Session, user: User, order_id: str, payload: PaymentCreate, request_id: str = "") -> Payment:
    order = get_order(db, user, order_id, lock=True)
    require(user.id == order.client_id, "只有当事人可以发起支付", 403, "forbidden")
    require(order.status == "pending_payment" and order.payment_status != "paid", "订单当前不可支付", 409, "invalid_state")
    due = money(order.price) - money(order.paid)
    amount = money(payload.amount or due)
    require(amount == due, "支付金额必须等于应付金额", 422, "invalid_amount")
    provider = get_payment_provider(payload.provider)
    existing = db.query(Payment).filter(Payment.order_id == order.id, Payment.status.in_(["creating", "created", "pending"])).first()
    if existing:
        if provider.name == "stub" and not existing.client_params.get("qr_svg_base64"):
            existing.client_params = provider.create_intent(existing, order.title)
            db.flush()
        return existing
    payment = Payment(id=new_id(), order_id=order.id, provider=provider.name, merchant_id=provider.merchant_id, intent_id=uuid4().hex, amount=amount, status="creating", expires_at=datetime.now(timezone.utc) + timedelta(minutes=30))
    if provider.name == "stub":
        payment.client_params = provider.create_intent(payment, order.title)
        payment.status = "created"
    db.add(payment)
    record_audit(db, user, "payment.created", "payment", payment.id, {"order_id": order.id, "amount": str(amount)}, request_id)
    commit_event(db, "payment.created", "payment", payment.id, {"order_id": order.id, "amount": str(amount)})
    db.flush()
    db.refresh(payment)
    return payment




def create_delivery(db: Session, user: User, order_id: str, payload: DeliveryCreate, request_id: str = "") -> Delivery:
    order = get_order(db, user, order_id, lock=True)
    require(user.id == order.lawyer_id, "只有服务律师可以提交交付物", 403, "forbidden")
    require(order.status in ("service", "pending_delivery"), "订单当前不可交付", 409, "invalid_state")
    if payload.document_id:
        from app.services.documents import get_document

        document = get_document(db, user, payload.document_id)
        require(document.order_id == order.id, "交付文书不属于当前订单", 422, "invalid_delivery_document")
    delivery = Delivery(id=new_id(), order_id=order.id, document_id=payload.document_id, submitted_by=user.id, status="submitted")
    db.add(delivery)
    order.status = "pending_receipt"
    order.version += 1
    notify(db, order.client_id, "收到新的交付物", f"订单“{order.title}”等待确认收悉", "order", order.id)
    record_audit(db, user, "delivery.submitted", "delivery", delivery.id, {"order_id": order.id}, request_id)
    commit_event(db, "delivery.submitted", "delivery", delivery.id, {"order_id": order.id})
    db.flush()
    db.refresh(delivery)
    return delivery


def receive_delivery(db: Session, user: User, order_id: str, accepted: bool, reason: str = "", request_id: str = "") -> Order:
    order = get_order(db, user, order_id, lock=True)
    require(user.id == order.client_id, "只有当事人可以确认交付", 403, "forbidden")
    require(order.status == "pending_receipt", "订单当前没有待确认交付物", 409, "invalid_state")
    if accepted:
        order.status = "completed"
        order.settlement_status = "pending"
        notify(db, order.lawyer_id, "交付已确认", f"订单“{order.title}”已完成", "order", order.id)
        action = "delivery.received"
    else:
        require(reason.strip(), "退回交付物必须填写原因", 422, "reason_required")
        order.status = "service"
        notify(db, order.lawyer_id, "交付物被退回", reason, "order", order.id)
        action = "delivery.returned"
    delivery = db.query(Delivery).filter_by(order_id=order.id, status="submitted").order_by(Delivery.created_at.desc()).with_for_update().first()
    if delivery:
        delivery.status = "accepted" if accepted else "returned"
        delivery.reason = reason
    order.version += 1
    record_audit(db, user, action, "order", order.id, {"reason": reason}, request_id)
    commit_event(db, action, "order", order.id, {"reason": reason})
    db.flush()
    db.refresh(order)
    return order


def open_case(db: Session, user: User, order_id: str, payload: AfterSalesCreate, request_id: str = "") -> AfterSalesCase:
    order = get_order(db, user, order_id, lock=True)
    require(user.id == order.client_id, "只有当事人可以发起售后", 403, "forbidden")
    require(order.status not in ("closed", "refund_pending"), "订单当前不可新建售后", 409, "invalid_state")
    amount = money(payload.amount)
    require(payload.case_type != "refund" or amount > 0, "退款金额必须大于0", 422, "invalid_amount")
    require(amount <= money(order.paid), "申请金额不能超过已支付金额", 422, "invalid_amount")
    existing = db.query(AfterSalesCase).filter(AfterSalesCase.order_id == order.id, AfterSalesCase.status == "pending").first()
    require(existing is None, "该订单已有待处理售后", 409, "duplicate_case")
    case = AfterSalesCase(id=new_id(), order_id=order.id, created_by=user.id, case_type=payload.case_type, reason=payload.reason, amount=amount, status="pending")
    case.previous_order_status = order.status
    case.previous_settlement_status = order.settlement_status
    db.add(case)
    order.status = "refund_pending" if payload.case_type == "refund" else "disputed"
    order.settlement_status = "frozen"
    order.version += 1
    record_audit(db, user, f"{payload.case_type}.created", "case", case.id, {"order_id": order.id}, request_id)
    commit_event(db, f"{payload.case_type}.created", "case", case.id, {"order_id": order.id})
    db.flush()
    db.refresh(case)
    return case


def resolve_case(db: Session, actor: User, case_id: str, decision: str, resolution: str, request_id: str = "") -> AfterSalesCase:
    require(actor.has_role("operator"), "只有运营人员可以处理售后", 403, "forbidden")
    case = db.get(AfterSalesCase, case_id)
    require(case is not None, "售后案件不存在", 404, "not_found")
    require(case.status == "pending", "售后案件已处理", 409, "invalid_state")
    order = db.query(Order).filter(Order.id == case.order_id).with_for_update().first()
    require(order is not None, "订单不存在", 404, "not_found")
    case = db.query(AfterSalesCase).filter_by(id=case_id).with_for_update().populate_existing().one()
    require(case.status == "pending", "售后案件已处理", 409, "invalid_state")
    case.status = "approved" if decision == "approve" else "rejected"
    case.resolution = resolution
    if decision == "approve":
        if case.case_type == "refund":
            require(case.amount > 0, "退款金额必须大于0", 422, "invalid_amount")
            payment = db.query(Payment).filter_by(order_id=order.id, status="success").with_for_update().first()
            require(payment is not None, "无可退款的真实支付记录", 409, "payment_not_found")
            reserved = sum((item.amount for item in db.query(Refund).filter(Refund.payment_id == payment.id, Refund.status.in_(["pending", "processing", "success"])).all()), Decimal("0"))
            require(reserved + case.amount <= payment.amount, "累计退款超出实付金额", 409, "refund_exceeds_payment")
            refund = Refund(id=new_id(), payment_id=payment.id, case_id=case.id, amount=case.amount)
            db.add(refund)
            case.status = "refund_processing"
            order.status = "refund_pending"
            order.settlement_status = "frozen"
            if payment.provider == "stub":
                refund.status = "success"
                refund.provider_refund_id = "test-" + refund.id
                payment.refunded = money(payment.refunded) + case.amount
                case.status = "approved"
                order.status = "closed" if payment.refunded == order.paid else "service"
                order.settlement_status = "refunded" if payment.refunded == order.paid else "partially_refunded"
        else:
            order.status = "disputed"
    else:
        order.status = case.previous_order_status
        order.settlement_status = case.previous_settlement_status
    order.version += 1
    notify(db, order.client_id, "售后处理完成", resolution, "case", case.id)
    notify(db, order.lawyer_id, "售后处理完成", resolution, "case", case.id)
    record_audit(db, actor, "case.resolved", "case", case.id, {"decision": decision}, request_id)
    commit_event(db, "case.resolved", "case", case.id, {"order_id": order.id, "decision": decision})
    db.flush()
    db.refresh(case)
    return case
