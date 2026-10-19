from datetime import date

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.errors import DomainError, require
from app.models import (
    AccessGrant,
    Document,
    DocumentVersion,
    LawyerProfile,
    Order,
    Quote,
    ServiceRequest,
    User,
)
from app.schemas import QuoteCreate, RequestCreate
from app.services.common import commit_event, new_id, notify, record_audit, stable_hash


def create_request(db: Session, user: User, payload: RequestCreate, request_id: str = "") -> ServiceRequest:
    require(user.has_role("client"), "只有当事人可以发布需求", 403, "forbidden")
    require(payload.deadline >= date.today(), "期望截止日期不能早于今天", 422, "invalid_deadline")
    if payload.source_consultation_id:
        from app.models import Consent, Consultation

        consultation = db.get(Consultation, payload.source_consultation_id)
        require(consultation is not None and consultation.owner_id == user.id, "咨询来源无效", 422, "invalid_source")
        require(bool(payload.consent_id), "请选择本次授权摘要ID", 422, "consent_required")
        query = db.query(Consent).filter_by(owner_id=user.id, source_id=payload.source_consultation_id)
        if payload.consent_id:
            query = query.filter_by(id=payload.consent_id)
        consent = query.order_by(Consent.created_at.desc()).first()
        require(payload.consent and consent is not None and bool(consent.snapshot_json), "转为需求必须明确授权并保存快照", 422, "consent_required")
    request = ServiceRequest(
        id=new_id(),
        owner_id=user.id,
        source_consultation_id=payload.source_consultation_id,
        consent_id=consent.id if payload.source_consultation_id else None,
        title=payload.title,
        domain=payload.domain,
        field=payload.field,
        service_type=payload.service_type,
        facts=payload.facts,
        region=payload.region,
        budget=payload.budget,
        deadline=payload.deadline,
        deliverables=payload.deliverables,
        visibility=payload.visibility,
        status="quoting",
    )
    db.add(request)
    record_audit(db, user, "request.created", "request", request.id, {"source": payload.source_consultation_id}, request_id)
    commit_event(db, "request.created", "request", request.id, {"owner_id": user.id})
    db.flush()
    db.refresh(request)
    return request


def visible_requests(db: Session, user: User, offset=0, limit=50) -> list[ServiceRequest]:
    if user.has_role("operator"):
        return db.query(ServiceRequest).order_by(ServiceRequest.created_at.desc()).offset(offset).limit(limit).all()
    profile = db.get(LawyerProfile, user.id)
    query = db.query(ServiceRequest)
    if active_lawyer(user, profile):
        query = query.filter(or_(ServiceRequest.owner_id == user.id, (ServiceRequest.visibility == "认证律师可见") & ServiceRequest.status.in_(["quoting", "published"])))
    else:
        query = query.filter(ServiceRequest.owner_id == user.id)
    return query.order_by(ServiceRequest.created_at.desc()).offset(offset).limit(limit).all()


def active_lawyer(user, profile):
    return bool(user.has_role("lawyer") and user.is_active and profile and profile.status == "approved" and profile.available and profile.expires_on and profile.expires_on >= date.today())


def list_lawyers(db: Session, field: str | None, region: str | None, available_only: bool = True):
    from app.models import UserRole

    query = db.query(LawyerProfile, User).join(User, User.id == LawyerProfile.user_id).filter(LawyerProfile.status == "approved", LawyerProfile.expires_on >= date.today(), User.is_active.is_(True), User.id.in_(db.query(UserRole.user_id).filter_by(role="lawyer")))
    if available_only:
        query = query.filter(LawyerProfile.available.is_(True))
    if field:
        query = query.filter(LawyerProfile.field == field)
    if region:
        query = query.filter(LawyerProfile.region == region)
    return query.order_by(LawyerProfile.created_at.desc()).limit(100).all()


def create_quote(db: Session, user: User, request_id: str, payload: QuoteCreate, request_context: str = "") -> Quote:
    require(user.has_role("lawyer"), "只有律师可以报价", 403, "forbidden")
    request = db.get(ServiceRequest, request_id)
    require(request is not None, "需求不存在", 404, "not_found")
    profile = db.query(LawyerProfile).filter_by(user_id=user.id).with_for_update().first()
    require(active_lawyer(user, profile), "律师资质或接单状态不可用", 403, "lawyer_unavailable")
    require(request.owner_id != user.id, "不能对本人需求报价", 403, "self_quote_forbidden")
    require(request.status in ("quoting", "published"), "当前需求不接受报价", 409, "invalid_state")
    require(payload.valid_until >= date.today(), "报价有效期必须在未来", 422, "invalid_quote")
    existing = db.query(Quote).filter_by(request_id=request_id, lawyer_id=user.id).filter(Quote.status == "valid").first()
    if existing:
        raise DomainError("同一律师只能保留一份有效报价", 409, "duplicate_quote")
    quote = Quote(
        id=new_id(), request_id=request_id, lawyer_id=user.id, scope=payload.scope,
        deliverables=payload.deliverables, price=payload.price, days=payload.days,
        valid_until=payload.valid_until, status="valid",
    )
    db.add(quote)
    notify(db, request.owner_id, "收到新的律师报价", f"需求“{request.title}”收到一份报价", "request", request.id)
    record_audit(db, user, "quote.created", "quote", quote.id, {"request_id": request.id}, request_context)
    commit_event(db, "quote.created", "quote", quote.id, {"request_id": request.id})
    db.flush()
    db.refresh(quote)
    return quote


def accept_quote(db: Session, user: User, quote_id: str, request_id: str = "") -> Order:
    require(user.has_role("client"), "只有当事人可以接受报价", 403, "forbidden")
    quote = db.get(Quote, quote_id)
    require(quote is not None, "报价不存在", 404, "not_found")
    request = db.query(ServiceRequest).filter(ServiceRequest.id == quote.request_id).with_for_update().first()
    require(request is not None and request.owner_id == user.id, "无权处理此报价", 403, "forbidden")
    existing = db.query(Order).filter(Order.request_id == request.id).with_for_update().first()
    if existing:
        require(existing.quote_id == quote_id, "该需求已接受其他报价", 409, "quote_conflict")
        return existing
    quote = db.query(Quote).filter(Quote.id == quote_id).with_for_update().one()
    require(quote.valid_until >= date.today(), "报价已过有效期", 409, "quote_expired")
    require(active_lawyer(db.get(User, quote.lawyer_id), db.get(LawyerProfile, quote.lawyer_id)), "律师目前无法新接单", 409, "lawyer_unavailable")
    require(quote.status == "valid", "报价已失效或已被接受", 409, "quote_unavailable")
    require(request.status in ("quoting", "published"), "需求当前不可下单", 409, "invalid_state")
    order = Order(
        id=new_id(), request_id=request.id, quote_id=quote.id, client_id=user.id,
        lawyer_id=quote.lawyer_id, title=request.title, scope=quote.scope,
        price=quote.price, status="pending_payment", payment_status="unpaid",
        settlement_status="frozen",
    )
    db.add(order)
    db.flush()
    quote.status = "accepted"
    quote.version += 1
    db.query(Quote).filter(Quote.request_id == request.id, Quote.id != quote.id, Quote.status == "valid").update({"status": "expired", "version": Quote.version + 1}, synchronize_session=False)
    request.status = "ordered"
    request.version += 1
    contract = Document(
        id=new_id(), order_id=order.id, owner_id=user.id, title=f"{request.title}·服务合同",
        doc_type="service_contract", status="draft", current_version=1,
        members_json=[user.id, quote.lawyer_id],
    )
    db.add(contract)
    db.flush()
    db.add(DocumentVersion(id=new_id(), document_id=contract.id, number=1, body=f"服务范围：{quote.scope}\n费用：{quote.price}\n交付物：{quote.deliverables}", body_hash=stable_hash({"scope": quote.scope, "price": str(quote.price)}), author_id=user.id))
    for member in [user.id, quote.lawyer_id]:
        db.add(AccessGrant(id=new_id(), document_id=contract.id, user_id=member, can_view=True, can_edit=True))
    notify(db, quote.lawyer_id, "报价已被接受", f"需求“{request.title}”已生成订单", "order", order.id)
    record_audit(db, user, "quote.accepted", "order", order.id, {"quote_id": quote.id}, request_id)
    commit_event(db, "order.created", "order", order.id, {"request_id": request.id, "lawyer_id": quote.lawyer_id})
    db.flush()
    db.refresh(order)
    return order
