from app.core.idempotency import TransactionalRouter
from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.serializers import application_out, lawyer_out, order_out, quote_out, request_out, service_out, user_briefs
from app.core.database import get_db
from app.core.deps import current_user, idempotency_key, request_context
from app.models import LawyerApplication, LawyerProfile, LawyerService, Order, OrderReview, Quote, ServiceRequest, StoredFile, User
from app.schemas import LawyerApply, LawyerInvite, LawyerProfileUpdate, LawyerServiceIn, QuoteCreate, ReasonBody, RequestCreate, RequestReopen, RequestUpdate, ServicePurchase
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
    marketplace.expire_overdue_requests(db)
    items = marketplace.visible_requests(db, user, offset, limit, {"status": status, "domain": domain, "field": field, "region": region})
    counts = marketplace.quote_counts(db, [item.id for item in items])
    quoted = {row[0] for row in db.query(Quote.request_id).filter(Quote.lawyer_id == user.id, Quote.request_id.in_([item.id for item in items] or [""])).all()}
    return [request_out(item, {**marketplace.request_view(db, user, item), "quote_count": counts.get(item.id, 0), "quoted_by_me": item.id in quoted}) for item in items]


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
    require(engaged or item.owner_id == user.id or user.has_role("operator") or item.visibility == marketplace.PUBLIC_VISIBILITY, "无权访问此需求", 403, "forbidden")
    marketplace.expire_overdue_requests(db)
    marketplace.expire_stale_quotes(db, item.id)
    return request_out(item, {**marketplace.request_view(db, user, item), "quote_count": marketplace.quote_counts(db, [item.id]).get(item.id, 0)})


@router.post("/requests/{request_id}/reopen")
def reopen_request(request_id: str, payload: RequestReopen, db: Session = Depends(get_db), user: User = Depends(current_user), context=Depends(request_context)):
    return request_out(marketplace.reopen_request(db, user, request_id, payload.deadline, context["request_id"]))


@router.post("/requests/{request_id}/invitations")
def invite_lawyer(request_id: str, payload: LawyerInvite, db: Session = Depends(get_db), user: User = Depends(current_user), context=Depends(request_context)):
    marketplace.invite_lawyer(db, user, request_id, payload.lawyer_id, context["request_id"])
    return {"invited": True, "lawyer_id": payload.lawyer_id}


@router.get("/quotes/mine")
def my_quotes(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return [{**quote_out(quote), "request": {"id": request.id, "title": request.title, "status": request.status, "region": request.region, "service_type": request.service_type, "budget": request.budget, "visibility": request.visibility}} for quote, request in marketplace.my_quotes(db, user)]


@router.get("/requests/{request_id}/files/{file_id}")
def download_request_file(request_id: str, file_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from app.core.errors import require

    item = db.get(ServiceRequest, request_id)
    require(item is not None, "需求不存在", 404, "not_found")
    require(marketplace.can_download_request_attachments(db, user, item), "仅需求本人和成单律师可下载原始附件", 403, "forbidden")
    require(any(attachment["file_id"] == file_id for attachment in (item.attachments_json or [])), "附件未关联到此需求", 404, "not_found")
    stored = db.get(StoredFile, file_id)
    require(stored is not None and stored.status == "available" and stored.owner_id == item.owner_id and stored.document_id is None, "附件不可用", 404, "not_found")
    return FileResponse(stored.storage_path, filename=stored.original_name, media_type="application/octet-stream", headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


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



@router.put("/lawyers/me/profile")
def update_profile(payload: LawyerProfileUpdate, db: Session = Depends(get_db), user: User = Depends(current_user), context=Depends(request_context)):
    return lawyer_out(marketplace.update_lawyer_profile(db, user, payload, context["request_id"]), user, private=True)


@router.get("/lawyers/me/services")
def my_services(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return [service_out(item) for item in marketplace.services_of(db, user.id, include_inactive=True)]


@router.post("/lawyers/me/services")
def create_service(payload: LawyerServiceIn, db: Session = Depends(get_db), user: User = Depends(current_user), context=Depends(request_context)):
    return service_out(marketplace.save_service(db, user, payload, None, context["request_id"]))


@router.put("/lawyers/me/services/{service_id}")
def update_service(service_id: str, payload: LawyerServiceIn, db: Session = Depends(get_db), user: User = Depends(current_user), context=Depends(request_context)):
    return service_out(marketplace.save_service(db, user, payload, service_id, context["request_id"]))


def mask_name(name: str | None) -> str:
    name = (name or "用户").strip()
    return name[0] + "**" if len(name) > 1 else name + "**"


@router.get("/lawyers/{lawyer_id}")
def lawyer_detail(lawyer_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from app.core.errors import require

    profile = db.get(LawyerProfile, lawyer_id)
    lawyer = db.get(User, lawyer_id)
    require(profile is not None and lawyer is not None and profile.status == "approved" and lawyer.is_active, "律师不存在或资质已失效", 404, "not_found")
    result = lawyer_out(profile, lawyer, stats=marketplace.lawyer_stats(db, [lawyer_id]).get(lawyer_id))
    result["can_take_orders"] = marketplace.active_lawyer(lawyer, profile)
    result["services"] = [service_out(item) for item in marketplace.services_of(db, lawyer_id)]
    reviews = db.query(OrderReview, Order).join(Order, Order.id == OrderReview.order_id).filter(OrderReview.target_id == lawyer_id, Order.lawyer_id == lawyer_id).order_by(OrderReview.created_at.desc()).limit(10).all()
    authors = user_briefs(db, [review.author_id for review, _ in reviews])
    result["reviews"] = [{"rating": review.rating, "content": review.content, "author": mask_name(authors.get(review.author_id, {}).get("name")), "service_type": order.title, "created_at": review.created_at} for review, order in reviews]
    return result


@router.get("/services")
def browse_services(field: str | None = Query(default=None, max_length=100), keyword: str | None = Query(default=None, max_length=50), db: Session = Depends(get_db), user: User = Depends(current_user)):
    rows = marketplace.list_lawyers(db, None, None, True, None)
    lawyers = {lawyer.id: (profile, lawyer) for profile, lawyer in rows}
    query = db.query(LawyerService).filter(LawyerService.active.is_(True), LawyerService.lawyer_id.in_(list(lawyers) or [""]))
    if field:
        query = query.filter(LawyerService.field == field)
    if keyword:
        like = f"%{keyword.strip()}%"
        from sqlalchemy import or_

        query = query.filter(or_(LawyerService.title.like(like), LawyerService.description.like(like), LawyerService.service_type.like(like)))
    services = query.order_by(LawyerService.sold.desc(), LawyerService.price).limit(100).all()
    stats = marketplace.lawyer_stats(db, list({item.lawyer_id for item in services}))
    def card(lawyer_id):
        profile, lawyer = lawyers[lawyer_id]
        return {"id": lawyer.id, "name": lawyer.name, "avatar": lawyer.avatar_data, "firm": profile.firm, "region": profile.region, **stats.get(lawyer_id, {})}
    return [service_out(item, card(item.lawyer_id)) for item in services]


@router.post("/services/{service_id}/purchase")
def purchase_service(service_id: str, payload: ServicePurchase, db: Session = Depends(get_db), user: User = Depends(current_user), key: str | None = Depends(idempotency_key), context=Depends(request_context)):
    return order_out(marketplace.purchase_service(db, user, service_id, payload, context["request_id"]))
