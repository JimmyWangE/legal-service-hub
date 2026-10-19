from app.core.idempotency import TransactionalRouter
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.serializers import application_out, lawyer_out, order_out, quote_out, request_out
from app.core.database import get_db
from app.core.deps import current_user, idempotency_key, request_context
from app.models import LawyerApplication, LawyerProfile, Order, Quote, ServiceRequest, User
from app.schemas import LawyerApply, QuoteCreate, RequestCreate
from app.services import identity, marketplace

router = TransactionalRouter(tags=["marketplace"])


@router.post("/requests")
def create_request(payload: RequestCreate, db: Session = Depends(get_db), user: User = Depends(current_user), context=Depends(request_context)):
    return request_out(marketplace.create_request(db, user, payload, context["request_id"]))


@router.get("/requests")
def list_requests(offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100), db: Session = Depends(get_db), user: User = Depends(current_user)):
    return [request_out(item) for item in marketplace.visible_requests(db, user, offset, limit)]


@router.get("/requests/{request_id}")
def get_request(request_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    item = db.get(ServiceRequest, request_id)
    if not item:
        from app.core.errors import DomainError

        raise DomainError("需求不存在", 404, "not_found")
    profile = db.get(LawyerProfile, user.id)
    allowed = user.has_role("operator") or item.owner_id == user.id or item.status in ("quoting", "published") and marketplace.active_lawyer(user, profile)
    from app.core.errors import require

    require(allowed, "无权访问此需求", 403, "forbidden")
    return request_out(item)


@router.get("/requests/{request_id}/quotes")
def list_quotes(request_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    item = db.get(ServiceRequest, request_id)
    from app.core.errors import require

    require(item is not None, "需求不存在", 404, "not_found")
    query = db.query(Quote).filter_by(request_id=request_id)
    if not user.has_role("operator") and item.owner_id != user.id:
        query = query.filter(Quote.lawyer_id == user.id)
    return [quote_out(quote) for quote in query.order_by(Quote.created_at).limit(100).all()]


@router.post("/requests/{request_id}/quotes")
def create_quote(request_id: str, payload: QuoteCreate, db: Session = Depends(get_db), user: User = Depends(current_user), context=Depends(request_context)):
    return quote_out(marketplace.create_quote(db, user, request_id, payload, context["request_id"]))


@router.post("/quotes/{quote_id}/accept")
def accept_quote(
    quote_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
    key: str | None = Depends(idempotency_key),
    context=Depends(request_context),
):
    quote = db.get(Quote, quote_id)
    from app.core.errors import require

    require(quote is not None, "报价不存在", 404, "not_found")
    payload = {"quote_id": quote_id}
    order = marketplace.accept_quote(db, user, quote_id, context["request_id"])
    result = order_out(order)
    return result


@router.get("/lawyers")
def list_lawyers(
    field: str | None = Query(default=None),
    region: str | None = Query(default=None),
    available_only: bool = True,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    return [lawyer_out(profile, lawyer) for profile, lawyer in marketplace.list_lawyers(db, field, region, available_only)]


@router.post("/lawyers/me/application")
def lawyer_application(payload: LawyerApply, db: Session = Depends(get_db), user: User = Depends(current_user), context=Depends(request_context)):
    profile = identity.apply_lawyer(db, user, payload, context["request_id"])
    return application_out(db, profile)


@router.get("/lawyers/me/application")
def application_me(db: Session = Depends(get_db), user: User = Depends(current_user)):
    applications = db.query(LawyerApplication).filter_by(user_id=user.id).order_by(LawyerApplication.version.desc()).limit(20).all()
    return [application_out(db, item) for item in applications]


@router.post("/lawyers/me/application/{application_id}/withdraw")
def withdraw(application_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from app.core.errors import require
    from app.services.common import record_audit

    item = db.query(LawyerApplication).filter_by(id=application_id, user_id=user.id).with_for_update().first()
    require(item is not None, "申请不存在", 404, "not_found")
    require(item.status in {"submitted", "under_review", "draft"}, "当前申请不可撤回", 409, "invalid_state")
    item.status = "withdrawn"
    record_audit(db, user, "lawyer.withdrawn", "lawyer_application", item.id)
    return application_out(db, item)


@router.get("/lawyers/me")
def lawyer_me(db: Session = Depends(get_db), user: User = Depends(current_user)):
    profile = db.get(LawyerProfile, user.id)
    from app.core.errors import require

    require(profile is not None, "律师资质不存在", 404, "not_found")
    return lawyer_out(profile, user, private=True)
