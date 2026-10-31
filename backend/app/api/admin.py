from fastapi import Depends, Query
from sqlalchemy.orm import Session

from app.api.serializers import application_out, lawyer_out, user_briefs
from app.core.database import get_db
from app.core.deps import current_user, request_context
from app.core.errors import require
from app.core.idempotency import TransactionalRouter
from app.models import AuditLog, LawyerApplication, LawyerProfile, StoredFile, User
from app.schemas import FreezeLawyer, LawyerReview
from app.services.identity import freeze_lawyer, review_application, unfreeze_lawyer


router = TransactionalRouter(prefix="/admin", tags=["admin"])


@router.get("/lawyers")
def lawyers(db: Session = Depends(get_db), user: User = Depends(current_user)):
    require(user.has_role("operator"), "仅运营可访问", 403, "forbidden")
    from app.services.marketplace import lawyer_stats

    profiles = db.query(LawyerProfile).order_by(LawyerProfile.created_at.desc()).limit(100).all()
    stats = lawyer_stats(db, [profile.user_id for profile in profiles])
    return [lawyer_out(profile, db.get(User, profile.user_id), private=True, stats=stats.get(profile.user_id)) for profile in profiles]


@router.get("/lawyer-applications")
def applications(status: str | None = None, offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100), db: Session = Depends(get_db), user: User = Depends(current_user)):
    require(user.has_role("operator"), "仅运营可访问", 403, "forbidden")
    query = db.query(LawyerApplication)
    if status:
        query = query.filter_by(status=status)
    return [application_out(db, item) for item in query.order_by(LawyerApplication.created_at.desc()).offset(offset).limit(limit).all()]


@router.get("/lawyer-applications/{application_id}")
def application(application_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    require(user.has_role("operator"), "仅运营可访问", 403, "forbidden")
    item = db.get(LawyerApplication, application_id)
    require(item is not None, "申请不存在", 404, "not_found")
    return application_out(db, item)


@router.post("/lawyer-applications/{application_id}/review")
def review(application_id: str, payload: LawyerReview, db: Session = Depends(get_db), user: User = Depends(current_user), context=Depends(request_context)):
    return application_out(db, review_application(db, user, application_id, payload, context["request_id"]))


@router.post("/lawyers/{lawyer_id}/review")
def legacy_review(lawyer_id: str, payload: LawyerReview, db: Session = Depends(get_db), user: User = Depends(current_user), context=Depends(request_context)):
    require(user.has_role("operator"), "仅运营可访问", 403, "forbidden")
    item = db.query(LawyerApplication).filter_by(user_id=lawyer_id, version=payload.expected_version).first()
    require(item is not None, "请通过申请ID及版本审核，禁止直接修改认证状态", 409, "application_required")
    return application_out(db, review_application(db, user, item.id, payload, context["request_id"]))


@router.post("/lawyers/{lawyer_id}/freeze")
def freeze(lawyer_id: str, payload: FreezeLawyer, db: Session = Depends(get_db), user: User = Depends(current_user), context=Depends(request_context)):
    return lawyer_out(freeze_lawyer(db, user, lawyer_id, payload.reason, context["request_id"]), db.get(User, lawyer_id), private=True)


@router.post("/lawyers/{lawyer_id}/unfreeze")
def unfreeze(lawyer_id: str, payload: FreezeLawyer, db: Session = Depends(get_db), user: User = Depends(current_user), context=Depends(request_context)):
    return lawyer_out(unfreeze_lawyer(db, user, lawyer_id, payload.reason, context["request_id"]), db.get(User, lawyer_id), private=True)


@router.get("/metrics")
def metrics(db: Session = Depends(get_db), user: User = Depends(current_user)):
    from sqlalchemy import func

    from app.models import AfterSalesCase, Consultation, Order, OrderReview, Payment, Quote, ServiceRequest, UserRole

    require(user.has_role("operator"), "仅运营可访问", 403, "forbidden")

    def count(query):
        return query.count()

    def rate(part, whole):
        return round(part / whole, 4) if whole else 0

    orders_by_status = dict(db.query(Order.status, func.count(Order.id)).group_by(Order.status).all())
    total_orders = sum(orders_by_status.values())
    paid_orders = db.query(Order).filter(Order.payment_status == "paid").count()
    requests_total = count(db.query(ServiceRequest))
    requests_quoted = db.query(func.count(func.distinct(Quote.request_id))).scalar() or 0
    payments_total = db.query(Payment).filter(Payment.status.in_(["success", "failed", "closed"])).count()
    payments_success = db.query(Payment).filter_by(status="success").count()
    refund_orders = db.query(func.count(func.distinct(AfterSalesCase.order_id))).filter(AfterSalesCase.case_type == "refund").scalar() or 0
    dispute_orders = db.query(func.count(func.distinct(AfterSalesCase.order_id))).filter(AfterSalesCase.case_type == "dispute").scalar() or 0
    avg_rating = db.query(func.avg(OrderReview.rating)).scalar()
    gmv = db.query(func.coalesce(func.sum(Order.paid), 0)).scalar()
    return {
        "users": count(db.query(User)),
        "lawyers": count(db.query(LawyerProfile).filter_by(status="approved")),
        "clients": count(db.query(UserRole).filter_by(role="client")),
        "consultations": count(db.query(Consultation)),
        "consultations_criminal": count(db.query(Consultation).filter_by(category="criminal")),
        "consultations_high_risk": count(db.query(Consultation).filter_by(risk_level="high")),
        "funnel": {"consultations": count(db.query(Consultation)), "requests": requests_total, "quoted": requests_quoted, "ordered": total_orders - orders_by_status.get("cancelled", 0), "paid": paid_orders, "completed": orders_by_status.get("completed", 0)},
        "orders_by_status": orders_by_status,
        "gmv": gmv,
        "payment_success_rate": rate(payments_success, payments_total),
        "refund_rate": rate(refund_orders, paid_orders),
        "dispute_rate": rate(dispute_orders, paid_orders),
        "avg_rating": round(float(avg_rating), 2) if avg_rating is not None else None,
        "pending_applications": count(db.query(LawyerApplication).filter(LawyerApplication.status.in_(["submitted", "under_review"]))),
        "pending_cases": count(db.query(AfterSalesCase).filter_by(status="pending")),
    }


@router.get("/lawyer-applications/{application_id}/files/{file_id}")
def credential_file(application_id: str, file_id: str, db: Session = Depends(get_db), user: User = Depends(current_user), context=Depends(request_context)):
    from fastapi.responses import FileResponse
    from app.services.common import record_audit

    require(user.has_role("operator"), "仅运营可访问", 403, "forbidden")
    item = db.get(LawyerApplication, application_id)
    require(item is not None and file_id in item.credential_file_ids, "材料不存在", 404, "not_found")
    stored = db.get(StoredFile, file_id)
    require(stored is not None and stored.owner_id == item.user_id and stored.status == "available", "材料不可用", 404, "not_found")
    record_audit(db, user, "lawyer.credential.downloaded", "lawyer_application", item.id, {"file_id": file_id}, context["request_id"])
    return FileResponse(stored.storage_path, filename=stored.original_name, media_type="application/octet-stream", headers={"Cache-Control": "private, no-store"})


@router.get("/audit")
def audit(
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    action: str | None = Query(default=None, max_length=100),
    object_type: str | None = Query(default=None, max_length=60),
    actor_id: str | None = Query(default=None, max_length=36),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    require(user.has_role("operator"), "仅运营可查看审计", 403, "forbidden")
    query = db.query(AuditLog)
    if action:
        query = query.filter(AuditLog.action.like(f"{action}%"))
    if object_type:
        query = query.filter_by(object_type=object_type)
    if actor_id:
        query = query.filter_by(actor_id=actor_id)
    items = query.order_by(AuditLog.created_at.desc()).offset(offset).limit(limit).all()
    people = user_briefs(db, [item.actor_id for item in items])
    return [{"id": item.id, "actor_id": item.actor_id, "actor_name": people.get(item.actor_id, {}).get("name") if item.actor_id else "系统", "action": item.action, "object_type": item.object_type, "object_id": item.object_id, "detail": item.detail_json, "request_id": item.request_id, "created_at": item.created_at} for item in items]


@router.get("/payment-status")
def payment_status(db: Session = Depends(get_db), user: User = Depends(current_user)):
    from app.models import PaymentTransaction, PaymentWebhookInbox, Refund

    require(user.has_role("operator"), "仅运营可访问", 403, "forbidden")
    return {"pending_inbox": db.query(PaymentWebhookInbox).filter(PaymentWebhookInbox.status.in_(["pending", "retry"])).count(), "manual_review": db.query(PaymentWebhookInbox).filter_by(status="manual_review").count(), "pending_refunds": db.query(Refund).filter(Refund.status.in_(["pending", "processing"])).count(), "overpayments": db.query(PaymentTransaction).filter_by(status="overpayment_review").count()}


@router.post("/maintenance/run")
def run_maintenance(db: Session = Depends(get_db), user: User = Depends(current_user), context=Depends(request_context)):
    """手动触发到期任务（Worker 每小时也会自动执行）：需求过期、交付自动验收、逾期提醒与订单结算。"""
    from app.services.common import record_audit
    from app.services.maintenance import run_due_jobs

    require(user.has_role("operator"), "仅运营可执行", 403, "forbidden")
    result = run_due_jobs(db)
    record_audit(db, user, "maintenance.run", "system", "maintenance", result, context["request_id"])
    return result


@router.get("/settlements")
def settlements(db: Session = Depends(get_db), user: User = Depends(current_user)):
    from sqlalchemy import func

    from app.models import Order

    require(user.has_role("operator"), "仅运营可访问", 403, "forbidden")
    rows = dict(db.query(Order.settlement_status, func.count(Order.id)).filter(Order.payment_status == "paid").group_by(Order.settlement_status).all())
    fee = db.query(func.coalesce(func.sum(Order.platform_fee), 0)).filter(Order.settlement_status == "settled").scalar()
    return {"by_status": rows, "platform_fee_total": fee}
