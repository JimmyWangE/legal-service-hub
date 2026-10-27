from app.core.idempotency import TransactionalRouter
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.serializers import application_out, lawyer_out, order_out, quote_out, request_out, user_briefs
from app.core.database import get_db
from app.core.deps import current_user, idempotency_key, request_context
from app.models import LawyerApplication, LawyerProfile, Order, Quote, ServiceRequest, User
from app.schemas import LawyerApply, QuoteCreate, ReasonBody, RequestCreate, RequestUpdate
from app.services import identity, marketplace

router = TransactionalRouter(tags=["marketplace"])


@router.post("/requests")
def create_request(payload: RequestCreate, db: Session = Depends(get_db), user: User = Depends(current_user), context=Depends(request_context)):
    return request_out(marketplace.create_request(db, user, payload, context["request_id"]))


@router.get("/requests")
def list_requests(
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    status: str | None = Query(default=None, max_length=30),
    domain: str | None = Query(default=None, max_length=30),
    field: str | None = Query(default=None, max_length=100),
    region: str | None = Query(default=None, max_length=100),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    items = marketplace.visible_requests(db, user, offset, limit, {"status": status, "domain": domain, "field": field, "region": region})
    return [request_out(item, marketplace.request_view(db, user, item)) for item in items]


@router.put("/requests/{request_id}")
def update_request(request_id: str, payload: RequestUpdate, db: Session = Depends(get_db), user: User = Depends(current_user), context=Depends(request_context)):
    return request_out(marketplace.update_request(db, user, request_id, payload, context["request_id"]))


@router.post("/requests/{request_id}/close")
def close_request(request_id: str, payload: ReasonBody, db: Session = Depends(get_db), user: User = Depends(current_user), context=Depends(request_context)):
    return request_out(marketplace.close_request(db, user, request_id, payload.reason, context["request_id"]))


@router.get("/requests/{request_id}")
def get_request(request_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    item = db.get(ServiceRequest, request_id)
    if not item:
        from app.core.errors import DomainError

        raise DomainError("需求不存在", 404, "not_found")
    profile = db.get(LawyerProfile, user.id)
    engaged = db.query(Quote.id).filter_by(request_id=item.id, lawyer_id=user.id).first() is not None
    allowed = user.has_role("operator") or item.owner_id == user.id or engaged or item.status == "quoting" and marketplace.active_lawyer(user, profile)
    from app.core.errors import require

    require(allowed, "无权访问此需求", 403, "forbidden")
    marketplace.expire_stale_quotes(db, item.id)
    return request_out(item, marketplace.request_view(db, user, item))


@router.get("/requests/{request_id}/quotes")
def list_quotes(request_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    item = db.get(ServiceRequest, request_id)
    from app.core.errors import require

    require(item is not None, "需求不存在", 404, "not_found")
    marketplace.expire_stale_quotes(db, request_id)
    query = db.query(Quote).filter_by(request_id=request_id)
    if not user.has_role("operator") and item.owner_id != user.id:
        query = query.filter(Quote.lawyer_id == user.id)
    quotes = query.order_by(Quote.created_at).limit(100).all()
    lawyer_ids = list({quote.lawyer_id for quote in quotes})
    people = user_briefs(db, lawyer_ids)
    profiles = {profile.user_id: profile for profile in db.query(LawyerProfile).filter(LawyerProfile.user_id.in_(lawyer_ids)).all()} if lawyer_ids else {}
    stats = marketplace.lawyer_stats(db, lawyer_ids)
    def lawyer_card(lawyer_id):
        profile = profiles.get(lawyer_id)
        return {**people.get(lawyer_id, {}), "firm": profile.firm if profile else "", "field": profile.field if profile else "", "region": profile.region if profile else "", **stats.get(lawyer_id, {})}
    return [quote_out(quote, lawyer_card(quote.lawyer_id)) for quote in quotes]


@router.post("/requests/{request_id}/quotes")
def create_quote(request_id: str, payload: QuoteCreate, db: Session = Depends(get_db), user: User = Depends(current_user), context=Depends(request_context)):
    return quote_out(marketplace.create_quote(db, user, request_id, payload, context["request_id"]))


@router.post("/quotes/{quote_id}/withdraw")
def withdraw_quote(quote_id: str, db: Session = Depends(get_db), user: User = Depends(current_user), context=Depends(request_context)):
    return quote_out(marketplace.withdraw_quote(db, user, quote_id, context["request_id"]))


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
    keyword: str | None = Query(default=None, max_length=50),
    available_only: bool = True,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    rows = marketplace.list_lawyers(db, field, region, available_only, keyword)
    stats = marketplace.lawyer_stats(db, [lawyer.id for _, lawyer in rows])
    return [lawyer_out(profile, lawyer, stats=stats.get(lawyer.id)) for profile, lawyer in rows]


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
