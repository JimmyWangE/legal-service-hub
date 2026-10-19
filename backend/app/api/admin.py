from fastapi import Depends, Query
from sqlalchemy.orm import Session

from app.api.serializers import application_out, lawyer_out
from app.core.database import get_db
from app.core.deps import current_user, request_context
from app.core.errors import require
from app.core.idempotency import TransactionalRouter
from app.models import AuditLog, LawyerApplication, LawyerProfile, StoredFile, User
from app.schemas import FreezeLawyer, LawyerReview
from app.services.identity import freeze_lawyer, review_application


router = TransactionalRouter(prefix="/admin", tags=["admin"])


@router.get("/lawyers")
def lawyers(db: Session = Depends(get_db), user: User = Depends(current_user)):
    require(user.has_role("operator"), "仅运营可访问", 403, "forbidden")
    return [lawyer_out(profile, db.get(User, profile.user_id), private=True) for profile in db.query(LawyerProfile).order_by(LawyerProfile.created_at.desc()).limit(100).all()]


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
def audit(offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=500), db: Session = Depends(get_db), user: User = Depends(current_user)):
    require(user.has_role("operator"), "仅运营可查看审计", 403, "forbidden")
    return [{"id": item.id, "actor_id": item.actor_id, "action": item.action, "object_type": item.object_type, "object_id": item.object_id, "detail": item.detail_json, "request_id": item.request_id, "created_at": item.created_at} for item in db.query(AuditLog).order_by(AuditLog.created_at.desc()).offset(offset).limit(limit).all()]


@router.get("/payment-status")
def payment_status(db: Session = Depends(get_db), user: User = Depends(current_user)):
    from app.models import PaymentTransaction, PaymentWebhookInbox, Refund

    require(user.has_role("operator"), "仅运营可访问", 403, "forbidden")
    return {"pending_inbox": db.query(PaymentWebhookInbox).filter(PaymentWebhookInbox.status.in_(["pending", "retry"])).count(), "manual_review": db.query(PaymentWebhookInbox).filter_by(status="manual_review").count(), "pending_refunds": db.query(Refund).filter(Refund.status.in_(["pending", "processing"])).count(), "overpayments": db.query(PaymentTransaction).filter_by(status="overpayment_review").count()}
