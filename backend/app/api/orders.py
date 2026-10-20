from app.core.idempotency import TransactionalRouter
from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response, PlainTextResponse
from starlette.concurrency import run_in_threadpool
from threading import BoundedSemaphore
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.api.serializers import case_out, order_out, payment_out, user_briefs
from app.core.database import get_db
from app.core.deps import current_user, idempotency_key, request_context
from app.core.errors import require
from app.models import AfterSalesCase, Delivery, Order, Payment, User
from app.schemas import AfterSalesCreate, CaseResolve, DeliveryCreate, PaymentCreate, PaymentWebhook
from app.services import trade
from app.services import payments
from app.core.config import get_settings
from app.core.payment_security import parse_alipay_event, parse_stub_event, parse_wechat_event
from app.services.payment_provider import get_payment_provider

router = TransactionalRouter(tags=["orders"])
verification_slots = BoundedSemaphore(8)


@router.get("/orders")
def list_orders(offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100), db: Session = Depends(get_db), user: User = Depends(current_user)):
    query = db.query(Order)
    if not user.has_role("operator"):
        query = query.filter(or_(Order.client_id == user.id, Order.lawyer_id == user.id))
    items = query.order_by(Order.created_at.desc()).offset(offset).limit(limit).all()
    people = user_briefs(db, [person for item in items for person in (item.client_id, item.lawyer_id)])
    return [order_out(item, people) for item in items]


@router.get("/orders/{order_id}")
def get_order(order_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    order = trade.get_order(db, user, order_id)
    return order_out(order, user_briefs(db, [order.client_id, order.lawyer_id]))


@router.post("/orders/{order_id}/payments")
def create_payment(
    order_id: str,
    payload: PaymentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
    key: str | None = Depends(idempotency_key),
    context=Depends(request_context),
):
    body = {"order_id": order_id, **payload.model_dump(mode="json")}
    payment = trade.create_payment(db, user, order_id, payload, context["request_id"])
    result = payment_out(payment)
    return result


@router.post("/orders/{order_id}/payments/{payment_id}/simulate-success")
def simulate_payment(
    order_id: str,
    payment_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
    key: str | None = Depends(idempotency_key),
    context=Depends(request_context),
):
    payment = payments.simulate_success(db, user, order_id, payment_id, context["request_id"])
    return payment_out(payment)


@router.post("/payments/webhooks/{provider}")
async def payment_webhook(provider: str, request: Request, db: Session = Depends(get_db)):
    settings = get_settings()
    get_payment_provider(provider)
    require(verification_slots.acquire(blocking=False), "通知认证繁忙，请稍后重试", 429, "webhook_busy")
    try:
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            require(len(raw) <= settings.payment_max_body_bytes, "通知过大", 413, "webhook_too_large")
        content_type = request.headers.get("content-type", "").split(";", 1)[0].lower()
        require(content_type == ("application/x-www-form-urlencoded" if provider == "alipay" else "application/json"), "通知格式不正确", 415, "invalid_content_type")

        def receive():
            parsers = {"wechatpay": lambda: parse_wechat_event(bytes(raw), request.headers), "alipay": lambda: parse_alipay_event(bytes(raw)), "stub": lambda: parse_stub_event(bytes(raw), request.headers)}
            event = parsers[provider]()
            inbox = payments.receive_event(db, bytes(raw), event)
            if provider == "stub" and inbox.status != "processed":
                payments.book_event(db, event)
                from datetime import datetime, timezone

                inbox.status = "processed"
                inbox.processed_at = datetime.now(timezone.utc)
            return inbox.id

        inbox_id = await run_in_threadpool(receive)
        if provider == "wechatpay":
            return Response(status_code=204)
        if provider == "alipay":
            return PlainTextResponse("success")
        return {"received": True, "inbox_id": inbox_id}
    finally:
        verification_slots.release()


@router.get("/orders/{order_id}/payments")
def list_payments(order_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    trade.get_order(db, user, order_id)
    return [payment_out(item) for item in db.query(Payment).filter_by(order_id=order_id).order_by(Payment.created_at.desc()).limit(20).all()]


@router.post("/orders/{order_id}/deliveries")
def delivery(order_id: str, payload: DeliveryCreate, db: Session = Depends(get_db), user: User = Depends(current_user), context=Depends(request_context)):
    return {"id": trade.create_delivery(db, user, order_id, payload, context["request_id"]).id, "status": "submitted"}


@router.get("/orders/{order_id}/deliveries")
def deliveries(order_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    trade.get_order(db, user, order_id)
    return [{"id": item.id, "document_id": item.document_id, "status": item.status, "created_at": item.created_at} for item in db.query(Delivery).filter_by(order_id=order_id).order_by(Delivery.created_at.desc()).limit(100).all()]


@router.get("/orders/{order_id}/after-sales")
def cases(order_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    trade.get_order(db, user, order_id)
    return [case_out(item) for item in db.query(AfterSalesCase).filter_by(order_id=order_id).order_by(AfterSalesCase.created_at.desc()).limit(100).all()]


@router.post("/orders/{order_id}/receipt")
def receipt(order_id: str, accepted: bool = Query(...), reason: str = Query(default=""), db: Session = Depends(get_db), user: User = Depends(current_user), context=Depends(request_context)):
    return order_out(trade.receive_delivery(db, user, order_id, accepted, reason, context["request_id"]))


@router.post("/orders/{order_id}/after-sales")
def after_sales(order_id: str, payload: AfterSalesCreate, db: Session = Depends(get_db), user: User = Depends(current_user), context=Depends(request_context)):
    return case_out(trade.open_case(db, user, order_id, payload, context["request_id"]))


@router.get("/admin/cases")
def list_cases(db: Session = Depends(get_db), user: User = Depends(current_user)):
    require(user.has_role("operator"), "只有运营人员可以查看售后案件", 403, "forbidden")
    return [case_out(item) for item in db.query(AfterSalesCase).order_by(AfterSalesCase.created_at.desc()).limit(100).all()]


@router.post("/admin/cases/{case_id}/resolve")
def resolve_case(case_id: str, payload: CaseResolve, db: Session = Depends(get_db), user: User = Depends(current_user), context=Depends(request_context)):
    return case_out(trade.resolve_case(db, user, case_id, payload.decision, payload.resolution, context["request_id"]))
