from decimal import Decimal
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy.orm import Session

from app.core.errors import DomainError, require
from app.core.config import get_settings
from app.models import AfterSalesCase, AuditLog, Delivery, Document, DocumentVersion, Order, OrderReview, Payment, Quote, Refund, ServiceRequest, User, WorkflowTask
from app.schemas import AfterSalesCreate, DeliveryCreate, PaymentCreate, PaymentWebhook, ReviewCreate
from app.services.common import commit_event, money, new_id, notify, record_audit, stable_hash
from app.services.payment_provider import get_payment_provider

DIRECT_VISIBILITY = "定向委托"


def aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


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
    if existing and existing.provider == "stub" and existing.expires_at and aware(existing.expires_at) <= datetime.now(timezone.utc):
        # 过期的模拟支付单不会被渠道回调关闭，必须在此关闭，否则当事人永远拿到同一张过期单无法付款
        existing.status = "closed"
        db.flush()
        existing = None
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
    require(order.status == "service", "订单当前不可交付", 409, "invalid_state")
    from app.services.documents import get_document

    document = get_document(db, user, payload.document_id)
    require(document.order_id == order.id, "交付文书不属于当前订单", 422, "invalid_delivery_document")
    require(document.doc_type != "service_contract", "服务合同不能作为交付物提交", 422, "invalid_delivery_document")
    require(document.status != "signing", "文书正在会签中，请会签完成后再提交交付", 409, "invalid_delivery_document")
    delivery = Delivery(id=new_id(), order_id=order.id, document_id=document.id, submitted_by=user.id, status="submitted", reason=payload.note)
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
        complete_order(db, order, user, reason, request_id)
        notify(db, order.lawyer_id, "交付已确认", f"订单“{order.title}”已完成", "order", order.id)
        db.flush()
        db.refresh(order)
        return order
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
    require(user.id in (order.client_id, order.lawyer_id), "只有订单双方可以发起售后", 403, "forbidden")
    require(payload.case_type == "dispute" or user.id == order.client_id, "只有当事人可以申请退款", 403, "forbidden")
    require(money(order.paid) > 0, "订单尚未支付，可直接取消订单", 409, "invalid_state")
    require(order.status in ("service", "pending_receipt", "completed"), "订单当前不可新建售后", 409, "invalid_state")
    require(order.settlement_status != "settled", "订单已完成结算，如有问题请联系平台客服", 409, "after_sales_expired")
    if order.status == "completed" and order.completed_at:
        window = timedelta(days=get_settings().after_sales_window_days)
        require(datetime.now(timezone.utc) - aware(order.completed_at) <= window, f"订单完成已超过{window.days}天，无法再申请售后", 409, "after_sales_expired")
    amount = money(payload.amount)
    require(payload.case_type == "refund" or user.id == order.client_id or amount == 0, "律师发起争议不涉及退款金额", 422, "invalid_amount")
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
    counterpart = order.lawyer_id if user.id == order.client_id else order.client_id
    notify(db, counterpart, "订单进入售后处理", f"订单“{order.title}”已发起{'退款申请' if payload.case_type == 'refund' else '争议'}，平台将介入处理", "order", order.id)
    record_audit(db, user, f"{payload.case_type}.created", "case", case.id, {"order_id": order.id}, request_id)
    commit_event(db, f"{payload.case_type}.created", "case", case.id, {"order_id": order.id})
    db.flush()
    db.refresh(case)
    return case


def resolve_case(db: Session, actor: User, case_id: str, decision: str, resolution: str, request_id: str = "", amount: Decimal | None = None) -> AfterSalesCase:
    """退款：同意即退款；争议：approve=支持当事人并按金额退款，complete=协商完成订单，reject=驳回恢复原状态。"""
    require(actor.has_role("operator"), "只有运营人员可以处理售后", 403, "forbidden")
    case = db.get(AfterSalesCase, case_id)
    require(case is not None, "售后案件不存在", 404, "not_found")
    require(case.status == "pending", "售后案件已处理", 409, "invalid_state")
    order = db.query(Order).filter(Order.id == case.order_id).with_for_update().first()
    require(order is not None, "订单不存在", 404, "not_found")
    case = db.query(AfterSalesCase).filter_by(id=case_id).with_for_update().populate_existing().one()
    require(case.status == "pending", "售后案件已处理", 409, "invalid_state")
    require(decision != "complete" or case.case_type == "dispute", "只有争议可以按协商完成订单处理", 422, "invalid_decision")
    case.resolution = resolution
    case.resolved_by = actor.id
    case.resolved_at = datetime.now(timezone.utc)
    if decision == "approve":
        if amount is not None:
            case.amount = money(amount)
        require(case.amount > 0, "同意退款时退款金额必须大于0", 422, "invalid_amount")
        require(case.amount <= money(order.paid), "退款金额不能超过已支付金额", 422, "invalid_amount")
        case.status = "approved"
        start_refund(db, order, case)
    elif decision == "complete":
        case.status = "approved"
        order.status = "completed"
        order.settlement_status = "pending"
        order.completed_at = order.completed_at or datetime.now(timezone.utc)
    else:
        case.status = "rejected"
        order.status = case.previous_order_status
        order.settlement_status = case.previous_settlement_status
    order.version += 1
    notify(db, order.client_id, "售后处理完成", resolution, "order", order.id)
    notify(db, order.lawyer_id, "售后处理完成", resolution, "order", order.id)
    record_audit(db, actor, "case.resolved", "case", case.id, {"decision": decision, "order_id": order.id}, request_id)
    commit_event(db, "case.resolved", "case", case.id, {"order_id": order.id, "decision": decision})
    db.flush()
    db.refresh(case)
    return case


def settle_refund(order: Order, case: AfterSalesCase | None, refunded_total: Decimal) -> None:
    """退款完成后：全额退款关闭订单，部分退款恢复到售后前的状态。"""
    full = refunded_total >= money(order.paid)
    if full:
        order.status = "closed"
        order.closed_reason = "全额退款"
        order.settlement_status = "refunded"
    else:
        order.status = case.previous_order_status if case else order.status
        if order.status in ("refund_pending", "disputed"):
            order.status = "service"
        order.settlement_status = "partially_refunded"


def start_refund(db: Session, order: Order, case: AfterSalesCase) -> None:
    payment = db.query(Payment).filter_by(order_id=order.id, status="success").with_for_update().first()
    require(payment is not None, "无可退款的支付记录", 409, "payment_not_found")
    reserved = sum((item.amount for item in db.query(Refund).filter(Refund.payment_id == payment.id, Refund.status.in_(["pending", "processing", "success"])).all()), Decimal("0"))
    require(reserved + case.amount <= payment.amount, "累计退款超出实付金额", 409, "refund_exceeds_payment")
    refund = Refund(id=new_id(), payment_id=payment.id, case_id=case.id, amount=case.amount)
    db.add(refund)
    order.status = "refund_pending"
    order.settlement_status = "frozen"
    if payment.provider == "stub":
        refund.status = "success"
        refund.provider_refund_id = "test-" + refund.id
        payment.refunded = money(payment.refunded) + case.amount
        settle_refund(order, case, payment.refunded)
    else:
        case.status = "refund_processing"


def confirm_contract(db: Session, user: User, order_id: str, request_id: str = "") -> Order:
    order = get_order(db, user, order_id, lock=True)
    require(user.id in (order.client_id, order.lawyer_id), "只有订单双方可以确认服务合同", 403, "forbidden")
    require(order.status == "pending_confirm", "订单当前不需要确认服务合同", 409, "invalid_state")
    now = datetime.now(timezone.utc)
    if user.id == order.client_id:
        require(order.client_confirmed_at is None, "您已确认过服务合同", 409, "already_confirmed")
        order.client_confirmed_at = now
        counterpart = order.lawyer_id
    else:
        require(order.lawyer_confirmed_at is None, "您已确认过服务合同", 409, "already_confirmed")
        order.lawyer_confirmed_at = now
        counterpart = order.client_id
    if order.client_confirmed_at and order.lawyer_confirmed_at:
        order.status = "pending_payment"
        contract = db.query(Document).filter_by(order_id=order.id, doc_type="service_contract").order_by(Document.created_at).first()
        if contract and contract.status == "draft":
            contract.status = "confirmed"
            contract.locked_version = contract.current_version
        notify(db, order.client_id, "服务合同已生效", f"订单“{order.title}”双方已确认，请完成支付", "order", order.id)
        notify(db, order.lawyer_id, "服务合同已生效", f"订单“{order.title}”双方已确认，等待当事人支付", "order", order.id)
    else:
        notify(db, counterpart, "请确认服务合同", f"对方已确认订单“{order.title}”的服务合同，等待您确认", "order", order.id)
    order.version += 1
    record_audit(db, user, "order.contract.confirmed", "order", order.id, {}, request_id)
    commit_event(db, "order.contract.confirmed", "order", order.id, {"user_id": user.id})
    db.flush()
    db.refresh(order)
    return order


def cancel_order(db: Session, user: User, order_id: str, reason: str = "", request_id: str = "") -> Order:
    order = get_order(db, user, order_id, lock=True)
    require(user.id in (order.client_id, order.lawyer_id), "只有订单双方可以取消订单", 403, "forbidden")
    require(order.status in ("pending_confirm", "pending_payment") and money(order.paid) == 0, "已付款或已开始服务的订单不能直接取消，请申请售后", 409, "invalid_state")
    active = db.query(Payment).filter(Payment.order_id == order.id, Payment.status.in_(["creating", "created", "pending"])).with_for_update().all()
    for payment in active:
        payment.status = "closed"
    order.status = "cancelled"
    order.closed_reason = reason.strip() or ("当事人取消" if user.id == order.client_id else "律师取消")
    order.version += 1
    quote = db.get(Quote, order.quote_id)
    if quote:
        quote.status = "cancelled"
        quote.version += 1
    request = db.query(ServiceRequest).filter_by(id=order.request_id).with_for_update().first()
    if request and request.status == "ordered":
        # 定向委托（服务套餐）只面向一位律师，取消后关闭需求，避免出现无人可见的“报价中”需求
        request.status = "closed" if request.visibility == DIRECT_VISIBILITY else "quoting"
        request.version += 1
    for document in db.query(Document).filter_by(order_id=order.id).all():
        if document.status in ("draft", "returned", "signing"):
            document.status = "archived"
    counterpart = order.lawyer_id if user.id == order.client_id else order.client_id
    notify(db, counterpart, "订单已取消", f"订单“{order.title}”已取消：{order.closed_reason}", "order", order.id)
    record_audit(db, user, "order.cancelled", "order", order.id, {"reason": order.closed_reason}, request_id)
    commit_event(db, "order.cancelled", "order", order.id, {"reason": order.closed_reason})
    db.flush()
    db.refresh(order)
    return order


def create_review(db: Session, user: User, order_id: str, payload: ReviewCreate, request_id: str = "") -> OrderReview:
    order = get_order(db, user, order_id, lock=True)
    require(user.id in (order.client_id, order.lawyer_id), "只有订单双方可以评价", 403, "forbidden")
    require(order.status == "completed", "订单完成后才能评价", 409, "invalid_state")
    require(db.query(OrderReview).filter_by(order_id=order.id, author_id=user.id).first() is None, "您已评价过该订单", 409, "duplicate_review")
    target = order.lawyer_id if user.id == order.client_id else order.client_id
    review = OrderReview(id=new_id(), order_id=order.id, author_id=user.id, target_id=target, rating=payload.rating, content=payload.content.strip())
    db.add(review)
    notify(db, target, "收到新的评价", f"订单“{order.title}”收到{payload.rating}星评价", "order", order.id)
    record_audit(db, user, "order.reviewed", "order", order.id, {"rating": payload.rating}, request_id)
    db.flush()
    db.refresh(review)
    return review


def evidence_package(db: Session, user: User, order_id: str, request_id: str = "") -> dict:
    order = get_order(db, user, order_id)
    people = {item.id: item.name for item in db.query(User).filter(User.id.in_([order.client_id, order.lawyer_id])).all()}
    quote = db.get(Quote, order.quote_id)
    documents = []
    for document in db.query(Document).filter_by(order_id=order.id).order_by(Document.created_at).all():
        versions = db.query(DocumentVersion).filter_by(document_id=document.id).order_by(DocumentVersion.number).all()
        tasks = db.query(WorkflowTask).filter_by(document_id=document.id).order_by(WorkflowTask.version_number, WorkflowTask.sequence).all()
        documents.append({
            "id": document.id, "title": document.title, "doc_type": document.doc_type, "status": document.status, "final_version": document.locked_version,
            "versions": [{"number": item.number, "sha256": item.body_hash, "author": people.get(item.author_id, item.author_id), "created_at": item.created_at} for item in versions],
            "workflow": [{"version": item.version_number, "sequence": item.sequence, "assignee": people.get(item.assignee_id, item.assignee_id), "status": item.status, "reason": item.reason, "updated_at": item.updated_at} for item in tasks],
        })
    document_ids = [item["id"] for item in documents]
    object_ids = [order.id, *document_ids, *(item.id for item in db.query(Payment).filter_by(order_id=order.id).all()), *(item.id for item in db.query(AfterSalesCase).filter_by(order_id=order.id).all()), *(item.id for item in db.query(Delivery).filter_by(order_id=order.id).all())]
    logs = db.query(AuditLog).filter(AuditLog.object_id.in_(object_ids)).order_by(AuditLog.created_at).limit(1000).all()
    package = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "order": {"id": order.id, "title": order.title, "client": people.get(order.client_id), "lawyer": people.get(order.lawyer_id), "scope": order.scope, "deliverables": order.deliverables, "days": order.days, "payment_terms": order.payment_terms, "price": str(order.price), "paid": str(order.paid), "status": order.status, "client_confirmed_at": order.client_confirmed_at, "lawyer_confirmed_at": order.lawyer_confirmed_at, "completed_at": order.completed_at, "created_at": order.created_at},
        "quote": {"id": quote.id, "price": str(quote.price), "days": quote.days, "valid_until": quote.valid_until, "created_at": quote.created_at} if quote else None,
        "documents": documents,
        "payments": [{"id": item.id, "amount": str(item.amount), "status": item.status, "refunded": str(item.refunded), "transaction_id": item.transaction_id, "created_at": item.created_at} for item in db.query(Payment).filter_by(order_id=order.id).order_by(Payment.created_at).all()],
        "deliveries": [{"id": item.id, "document_id": item.document_id, "status": item.status, "note": item.reason, "created_at": item.created_at} for item in db.query(Delivery).filter_by(order_id=order.id).order_by(Delivery.created_at).all()],
        "after_sales": [{"id": item.id, "type": item.case_type, "status": item.status, "amount": str(item.amount), "reason": item.reason, "resolution": item.resolution, "created_at": item.created_at, "resolved_at": item.resolved_at} for item in db.query(AfterSalesCase).filter_by(order_id=order.id).order_by(AfterSalesCase.created_at).all()],
        "reviews": [{"author": people.get(item.author_id), "rating": item.rating, "content": item.content, "created_at": item.created_at} for item in db.query(OrderReview).filter_by(order_id=order.id).all()],
        "audit_log": [{"action": item.action, "object_type": item.object_type, "object_id": item.object_id, "actor": people.get(item.actor_id, "平台系统" if item.actor_id is None else "平台运营"), "created_at": item.created_at} for item in logs],
    }
    package["package_sha256"] = stable_hash(package)
    record_audit(db, user, "order.evidence.exported", "order", order.id, {"package_sha256": package["package_sha256"]}, request_id)
    return package


def complete_order(db: Session, order: Order, actor: User | None, reason: str = "", request_id: str = "") -> None:
    order.status = "completed"
    order.settlement_status = "pending"
    order.completed_at = datetime.now(timezone.utc)
    order.version += 1
    delivery = db.query(Delivery).filter_by(order_id=order.id, status="submitted").order_by(Delivery.created_at.desc()).first()
    if delivery:
        delivery.status = "accepted"
        delivery.reason = reason
    record_audit(db, actor, "delivery.received" if actor else "delivery.auto_accepted", "order", order.id, {"reason": reason}, request_id)
    commit_event(db, "delivery.received", "order", order.id, {"auto": actor is None})


def auto_accept_deliveries(db: Session, now: datetime | None = None) -> int:
    """当事人超过约定天数未验收的交付，系统自动确认，避免律师的劳动成果被无限期挂起。"""
    now = now or datetime.now(timezone.utc)
    days = get_settings().delivery_auto_accept_days
    count = 0
    for order in db.query(Order).filter(Order.status == "pending_receipt").with_for_update().all():
        delivery = db.query(Delivery).filter_by(order_id=order.id, status="submitted").order_by(Delivery.created_at.desc()).first()
        if not delivery or now - aware(delivery.created_at) < timedelta(days=days):
            continue
        complete_order(db, order, None, f"当事人{days}天内未处理，系统自动确认验收")
        notify(db, order.client_id, "交付已自动确认", f"订单“{order.title}”的交付物超过{days}天未处理，系统已自动确认验收；如有异议可在售后期内申请售后", "order", order.id)
        notify(db, order.lawyer_id, "交付已自动确认", f"订单“{order.title}”已由系统自动确认验收", "order", order.id)
        count += 1
    db.flush()
    return count


def settle_orders(db: Session, now: datetime | None = None) -> int:
    """售后期结束且无待处理售后的已完成订单进入结算，按平台服务费率计算律师应得金额。"""
    now = now or datetime.now(timezone.utc)
    settings = get_settings()
    window = timedelta(days=settings.after_sales_window_days)
    count = 0
    candidates = db.query(Order).filter(Order.status == "completed", Order.settlement_status.in_(["pending", "partially_refunded"]), Order.completed_at.is_not(None)).with_for_update().all()
    for order in candidates:
        if now - aware(order.completed_at) < window:
            continue
        if db.query(AfterSalesCase.id).filter(AfterSalesCase.order_id == order.id, AfterSalesCase.status.in_(["pending", "refund_processing"])).first():
            continue
        refunded = sum((money(item.refunded) for item in db.query(Payment).filter_by(order_id=order.id).all()), Decimal("0"))
        net = max(money(order.paid) - refunded, Decimal("0"))
        order.platform_fee = money(net * Decimal(str(settings.platform_fee_rate)))
        order.settlement_status = "settled"
        order.settled_at = now
        order.version += 1
        notify(db, order.lawyer_id, "订单已结算", f"订单“{order.title}”已结算，服务收入 {money(net - order.platform_fee)} 元（已扣除平台服务费 {order.platform_fee} 元）", "order", order.id)
        record_audit(db, None, "order.settled", "order", order.id, {"net": str(net), "platform_fee": str(order.platform_fee)})
        commit_event(db, "order.settled", "order", order.id, {"platform_fee": str(order.platform_fee)})
        count += 1
    db.flush()
    return count


def overdue_reminders(db: Session, now: datetime | None = None) -> int:
    """服务中的订单超过约定交付期时，提醒律师与当事人各一次。"""
    from app.models import Notification

    now = now or datetime.now(timezone.utc)
    count = 0
    for order in db.query(Order).filter(Order.status == "service", Order.service_started_at.is_not(None), Order.days > 0).all():
        if now < aware(order.service_started_at) + timedelta(days=order.days):
            continue
        if db.query(Notification.id).filter_by(user_id=order.lawyer_id, object_type="order_overdue", object_id=order.id).first():
            continue
        notify(db, order.lawyer_id, "订单已超过约定交付期", f"订单“{order.title}”已超过约定的{order.days}天交付期，请尽快提交交付物或与当事人沟通", "order_overdue", order.id)
        notify(db, order.client_id, "律师交付已逾期", f"订单“{order.title}”已超过约定交付期，可联系律师了解进度；如需退款可申请售后", "order", order.id)
        count += 1
    db.flush()
    return count
