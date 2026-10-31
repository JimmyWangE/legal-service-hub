import re
from datetime import date

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.errors import DomainError, require
from app.models import (
    AccessGrant,
    Document,
    DocumentVersion,
    LawyerProfile,
    LawyerService,
    Notification,
    Order,
    OrderReview,
    Quote,
    ServiceRequest,
    StoredFile,
    User,
)
from app.schemas import LawyerProfileUpdate, LawyerServiceIn, QuoteCreate, RequestCreate, RequestUpdate, ServicePurchase
from app.services.common import commit_event, money, new_id, notify, record_audit, stable_hash

PUBLIC_VISIBILITY = "认证律师可见"
DIRECT_VISIBILITY = "定向委托"
CRIMINAL_FIELDS = {"刑事辩护", "刑事控告"}


def create_request(db: Session, user: User, payload: RequestCreate, request_id: str = "") -> ServiceRequest:
    require(user.has_role("client"), "只有当事人可以发布需求", 403, "forbidden")
    require(payload.deadline >= date.today(), "期望截止日期不能早于今天", 422, "invalid_deadline")
    attachments = request_attachments(db, user, payload.attachment_file_ids)
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
        require(db.query(ServiceRequest).filter_by(consent_id=consent.id).first() is None, "该授权摘要已用于发布需求，请重新授权生成", 409, "consent_used")
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
        attachments_json=attachments,
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


def request_attachments(db: Session, user: User, file_ids: list[str]) -> list[dict]:
    require(len(file_ids) == len(set(file_ids)), "请勿重复关联同一个附件", 422, "invalid_attachment")
    if not file_ids:
        return []
    stored = {item.id: item for item in db.query(StoredFile).filter(StoredFile.id.in_(file_ids)).all()}
    require(all(file_id in stored and stored[file_id].owner_id == user.id and stored[file_id].status == "available" and stored[file_id].document_id is None for file_id in file_ids), "附件不存在、不可用或不属于当前账户，请重新上传", 422, "invalid_attachment")
    return [{"file_id": item.id, "name": item.original_name, "size": item.size, "content_type": item.content_type} for item in (stored[file_id] for file_id in file_ids)]


def can_download_request_attachments(db: Session, user: User, request: ServiceRequest) -> bool:
    return request.owner_id == user.id or db.query(Order.id).filter(Order.request_id == request.id, Order.lawyer_id == user.id, Order.status != "cancelled").first() is not None


def visible_requests(db: Session, user: User, offset=0, limit=50, filters: dict | None = None) -> list[ServiceRequest]:
    query = db.query(ServiceRequest)
    if not user.has_role("operator"):
        profile = db.get(LawyerProfile, user.id)
        if active_lawyer(user, profile):
            query = query.filter(or_(ServiceRequest.owner_id == user.id, (ServiceRequest.visibility == PUBLIC_VISIBILITY) & (ServiceRequest.status == "quoting") & (ServiceRequest.deadline >= date.today())))
        else:
            query = query.filter(ServiceRequest.owner_id == user.id)
    for name, value in (filters or {}).items():
        if value:
            query = query.filter(getattr(ServiceRequest, name) == value)
    return query.order_by(ServiceRequest.created_at.desc()).offset(offset).limit(limit).all()


SENSITIVE_PATTERNS = (
    (re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)"), "1**********"),
    (re.compile(r"(?<![0-9A-Za-z])\d{17}[\dXx](?![0-9A-Za-z])"), "******************"),
    (re.compile(r"[\w.+-]+@[\w-]+(\.[\w-]+)+"), "***@***"),
)


def mask_sensitive(text: str) -> str:
    for pattern, replacement in SENSITIVE_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def request_view(db: Session, user: User, request: ServiceRequest) -> dict:
    """律师只看到脱敏需求；报价或成单后才可见当事人身份以便沟通。"""
    if user.has_role("operator") or request.owner_id == user.id:
        return {"masked": False, "reveal_owner": True, "can_download_attachments": request.owner_id == user.id}
    engaged = db.query(Quote.id).filter_by(request_id=request.id, lawyer_id=user.id).first() is not None
    return {"masked": True, "reveal_owner": engaged, "can_download_attachments": can_download_request_attachments(db, user, request)}


def update_request(db: Session, user: User, request_id: str, payload: RequestUpdate, request_context: str = "") -> ServiceRequest:
    request = db.query(ServiceRequest).filter_by(id=request_id).with_for_update().first()
    require(request is not None, "需求不存在", 404, "not_found")
    require(request.owner_id == user.id, "只能修改本人发布的需求", 403, "forbidden")
    require(request.status == "quoting", "需求当前不可修改", 409, "invalid_state")
    require(request.version == payload.expected_version, "需求已更新，请刷新后重试", 409, "version_conflict")
    require(db.query(Quote).filter_by(request_id=request.id, status="valid").first() is None, "已有律师报价，不能再修改需求内容，可关闭后重新发布", 409, "has_quotes")
    require(payload.deadline >= date.today(), "期望截止日期不能早于今天", 422, "invalid_deadline")
    for name in ("title", "domain", "field", "service_type", "facts", "region", "budget", "deadline", "deliverables"):
        setattr(request, name, getattr(payload, name))
    request.version += 1
    record_audit(db, user, "request.updated", "request", request.id, {}, request_context)
    db.flush()
    return request


def close_request(db: Session, user: User, request_id: str, reason: str = "", request_context: str = "") -> ServiceRequest:
    request = db.query(ServiceRequest).filter_by(id=request_id).with_for_update().first()
    require(request is not None, "需求不存在", 404, "not_found")
    require(request.owner_id == user.id, "只能关闭本人发布的需求", 403, "forbidden")
    require(request.status == "quoting", "需求已下单或已关闭", 409, "invalid_state")
    request.status = "closed"
    request.version += 1
    for quote in db.query(Quote).filter_by(request_id=request.id, status="valid").all():
        quote.status = "expired"
        quote.version += 1
        notify(db, quote.lawyer_id, "需求已关闭", f"当事人已关闭需求“{request.title}”，您的报价已失效", "request", request.id)
    record_audit(db, user, "request.closed", "request", request.id, {"reason": reason}, request_context)
    db.flush()
    return request


def expire_stale_quotes(db: Session, request_id: str | None = None) -> None:
    query = db.query(Quote).filter(Quote.status == "valid", Quote.valid_until < date.today())
    if request_id:
        query = query.filter(Quote.request_id == request_id)
    query.update({"status": "expired", "version": Quote.version + 1}, synchronize_session=False)


def withdraw_quote(db: Session, user: User, quote_id: str, request_context: str = "") -> Quote:
    quote = db.query(Quote).filter_by(id=quote_id).with_for_update().first()
    require(quote is not None, "报价不存在", 404, "not_found")
    require(quote.lawyer_id == user.id, "只能撤回本人的报价", 403, "forbidden")
    require(quote.status == "valid", "报价已被接受或已失效", 409, "invalid_state")
    quote.status = "withdrawn"
    quote.version += 1
    request = db.get(ServiceRequest, quote.request_id)
    notify(db, request.owner_id, "律师撤回了报价", f"需求“{request.title}”的一份报价已撤回", "request", request.id)
    record_audit(db, user, "quote.withdrawn", "quote", quote.id, {"request_id": request.id}, request_context)
    db.flush()
    return quote


def lawyer_stats(db: Session, lawyer_ids: list[str]) -> dict:
    if not lawyer_ids:
        return {}
    ratings = dict.fromkeys(lawyer_ids)
    # 只统计“当事人评价承办律师”：律师账户也可能以当事人身份下单，那时收到的评价不能计入律师评分
    rows = db.query(OrderReview.target_id, func.avg(OrderReview.rating), func.count(OrderReview.id)).join(Order, Order.id == OrderReview.order_id).filter(OrderReview.target_id.in_(lawyer_ids), Order.lawyer_id == OrderReview.target_id).group_by(OrderReview.target_id).all()
    completed = dict(db.query(Order.lawyer_id, func.count(Order.id)).filter(Order.lawyer_id.in_(lawyer_ids), Order.status == "completed").group_by(Order.lawyer_id).all())
    by_target = {target: (avg, count) for target, avg, count in rows}
    for lawyer_id in ratings:
        avg, count = by_target.get(lawyer_id, (None, 0))
        ratings[lawyer_id] = {"rating_avg": round(float(avg), 1) if avg is not None else None, "review_count": count, "completed_orders": completed.get(lawyer_id, 0)}
    return ratings


def active_lawyer(user, profile):
    return bool(user.has_role("lawyer") and user.is_active and profile and profile.status == "approved" and profile.available and profile.expires_on and profile.expires_on >= date.today())


def list_lawyers(db: Session, field: str | None, region: str | None, available_only: bool = True, keyword: str | None = None):
    from app.models import UserRole

    query = db.query(LawyerProfile, User).join(User, User.id == LawyerProfile.user_id).filter(LawyerProfile.status == "approved", LawyerProfile.expires_on >= date.today(), User.is_active.is_(True), User.id.in_(db.query(UserRole.user_id).filter_by(role="lawyer")))
    if available_only:
        query = query.filter(LawyerProfile.available.is_(True))
    if region:
        query = query.filter(or_(LawyerProfile.region == region, LawyerProfile.region == "全国"))
    if keyword:
        like = f"%{keyword.strip()[:50]}%"
        query = query.filter(or_(User.name.like(like), LawyerProfile.firm.like(like), LawyerProfile.field.like(like), LawyerProfile.bio.like(like)))
    rows = query.order_by(LawyerProfile.created_at.desc()).limit(200).all()
    if field:
        rows = [(profile, user) for profile, user in rows if profile.field == field or field in (profile.specialties or [])]
    return rows[:100]


def create_quote(db: Session, user: User, request_id: str, payload: QuoteCreate, request_context: str = "") -> Quote:
    require(user.has_role("lawyer"), "只有律师可以报价", 403, "forbidden")
    request = db.get(ServiceRequest, request_id)
    require(request is not None, "需求不存在", 404, "not_found")
    profile = db.query(LawyerProfile).filter_by(user_id=user.id).with_for_update().first()
    require(active_lawyer(user, profile), "律师资质或接单状态不可用", 403, "lawyer_unavailable")
    require(request.owner_id != user.id, "不能对本人需求报价", 403, "self_quote_forbidden")
    require(request.status == "quoting", "当前需求不接受报价", 409, "invalid_state")
    require(request.visibility == PUBLIC_VISIBILITY, "该需求为定向委托，不接受其他律师报价", 403, "forbidden")
    require(request.deadline >= date.today(), "需求已超过期望完成日期，不再接受报价", 409, "request_expired")
    require(payload.valid_until >= date.today(), "报价有效期必须在未来", 422, "invalid_quote")
    expire_stale_quotes(db, request_id)
    existing = db.query(Quote).filter_by(request_id=request_id, lawyer_id=user.id).filter(Quote.status == "valid").first()
    if existing:
        raise DomainError("同一律师只能保留一份有效报价", 409, "duplicate_quote")
    quote = Quote(
        id=new_id(), request_id=request_id, lawyer_id=user.id, scope=payload.scope,
        deliverables=payload.deliverables, price=payload.price, days=payload.days,
        payment_terms=payload.payment_terms, valid_until=payload.valid_until, status="valid",
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
    existing = db.query(Order).filter(Order.request_id == request.id, Order.status != "cancelled").with_for_update().first()
    if existing:
        require(existing.quote_id == quote_id, "该需求已接受其他报价", 409, "quote_conflict")
        return existing
    quote = db.query(Quote).filter(Quote.id == quote_id).with_for_update().one()
    require(quote.valid_until >= date.today(), "报价已过有效期", 409, "quote_expired")
    require(active_lawyer(db.get(User, quote.lawyer_id), db.get(LawyerProfile, quote.lawyer_id)), "律师目前无法新接单", 409, "lawyer_unavailable")
    require(quote.status == "valid", "报价已失效或已被接受", 409, "quote_unavailable")
    require(request.status == "quoting", "需求当前不可下单", 409, "invalid_state")
    order = Order(
        id=new_id(), request_id=request.id, quote_id=quote.id, client_id=user.id,
        lawyer_id=quote.lawyer_id, title=request.title, scope=quote.scope,
        deliverables=quote.deliverables, days=quote.days, payment_terms=quote.payment_terms,
        price=quote.price, status="pending_confirm", payment_status="unpaid",
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
    body = contract_body(request, quote, user, db.get(User, quote.lawyer_id))
    db.add(DocumentVersion(id=new_id(), document_id=contract.id, number=1, body=body, body_hash=stable_hash(body), author_id=user.id))
    for member in [user.id, quote.lawyer_id]:
        db.add(AccessGrant(id=new_id(), document_id=contract.id, user_id=member, can_view=True, can_edit=True))
    notify(db, quote.lawyer_id, "报价已被接受", f"需求“{request.title}”已生成订单，请确认服务合同", "order", order.id)
    record_audit(db, user, "quote.accepted", "order", order.id, {"quote_id": quote.id}, request_id)
    commit_event(db, "order.created", "order", order.id, {"request_id": request.id, "lawyer_id": quote.lawyer_id})
    db.flush()
    db.refresh(order)
    return order


def contract_body(request: ServiceRequest, quote: Quote, client: User, lawyer: User) -> str:
    from app.core.config import get_settings

    settings = get_settings()
    return "\n".join([
        f"《{request.title}》法律服务合同",
        "",
        f"委托人（甲方）：{client.name}",
        f"受托律师（乙方）：{lawyer.name if lawyer else ''}",
        f"服务地区：{request.region}    服务类型：{request.service_type}",
        "",
        "一、服务范围",
        quote.scope,
        "",
        "二、交付物",
        quote.deliverables,
        "",
        f"三、服务期限：自甲方付款经平台确认之日起 {quote.days} 日内完成交付。因甲方未及时提供必要材料导致的延误，期限相应顺延。",
        f"四、服务费用：人民币 {quote.price} 元（含税），由甲方通过平台支付，平台在订单完成且售后期届满后向乙方结算。",
        f"五、付款方式：{quote.payment_terms or '签署确认后一次性支付'}。",
        "",
        "六、双方权利义务",
        "1. 甲方应如实陈述事实、提供真实完整的材料，并对材料的真实性负责；",
        "2. 乙方应勤勉尽责、依法依规提供服务，按约定期限交付，并就服务进展与甲方保持沟通；",
        "3. 乙方不得向甲方承诺案件结果，不得私下收取约定以外的任何费用。",
        "",
        "七、保密：乙方对执业中知悉的甲方个人信息、商业秘密及案件信息负有保密义务，法律另有规定的除外。",
        "",
        f"八、验收：乙方提交交付物后，甲方可确认验收或说明理由退回修改；甲方 {settings.delivery_auto_accept_days} 日内未处理的，视为验收通过。",
        f"九、解除与退款：甲方付款前任何一方均可取消订单；付款后如需退款，甲方可在订单完成后 {settings.after_sales_window_days} 日内向平台申请，由平台依据服务完成情况核实处理。",
        "十、争议解决：双方发生争议应先协商，可申请平台介入调解；协商不成的，任何一方可向有管辖权的人民法院提起诉讼。",
        "",
        "十一、其他：本合同经甲乙双方在平台内确认后生效；平台内“确认”不等同于电子签名。平台提供信息撮合与履约保障服务，不是本合同的服务提供方。",
    ])


def expire_overdue_requests(db: Session) -> int:
    """超过期望完成日期仍未下单的公开需求自动过期，相关有效报价同步失效。"""
    overdue = db.query(ServiceRequest).filter(ServiceRequest.status == "quoting", ServiceRequest.deadline < date.today()).with_for_update().all()
    for request in overdue:
        request.status = "expired"
        request.version += 1
        for quote in db.query(Quote).filter_by(request_id=request.id, status="valid").all():
            quote.status = "expired"
            quote.version += 1
        notify(db, request.owner_id, "需求已过期", f"需求“{request.title}”已超过期望完成日期，可修改日期后重新开放报价", "request", request.id)
        record_audit(db, None, "request.expired", "request", request.id)
    if overdue:
        db.flush()
    return len(overdue)


def reopen_request(db: Session, user: User, request_id: str, deadline: date, request_context: str = "") -> ServiceRequest:
    request = db.query(ServiceRequest).filter_by(id=request_id).with_for_update().first()
    require(request is not None, "需求不存在", 404, "not_found")
    require(request.owner_id == user.id, "只能重新开放本人发布的需求", 403, "forbidden")
    require(request.status in ("expired", "closed"), "只有已过期或已关闭的需求可以重新开放", 409, "invalid_state")
    require(request.visibility == PUBLIC_VISIBILITY, "定向委托需求请重新选择服务套餐", 409, "invalid_state")
    require(deadline >= date.today(), "期望截止日期不能早于今天", 422, "invalid_deadline")
    request.deadline = deadline
    request.status = "quoting"
    request.version += 1
    record_audit(db, user, "request.reopened", "request", request.id, {"deadline": str(deadline)}, request_context)
    commit_event(db, "request.created", "request", request.id, {"owner_id": user.id, "reopened": True})
    db.flush()
    return request


def quote_counts(db: Session, request_ids: list[str]) -> dict[str, int]:
    if not request_ids:
        return {}
    return dict(db.query(Quote.request_id, func.count(Quote.id)).filter(Quote.request_id.in_(request_ids), Quote.status.in_(["valid", "accepted"])).group_by(Quote.request_id).all())


def invite_lawyer(db: Session, user: User, request_id: str, lawyer_id: str, request_context: str = "") -> None:
    request = db.get(ServiceRequest, request_id)
    require(request is not None and request.owner_id == user.id, "只能邀请律师为本人的需求报价", 403, "forbidden")
    require(request.status == "quoting" and request.deadline >= date.today(), "需求当前不接受报价", 409, "invalid_state")
    require(request.visibility == PUBLIC_VISIBILITY, "定向委托需求无需邀请", 409, "invalid_state")
    lawyer = db.get(User, lawyer_id)
    require(lawyer is not None and lawyer.id != user.id and active_lawyer(lawyer, db.get(LawyerProfile, lawyer_id)), "该律师当前无法接单", 409, "lawyer_unavailable")
    require(db.query(Quote.id).filter_by(request_id=request.id, lawyer_id=lawyer_id, status="valid").first() is None, "该律师已对此需求报价", 409, "already_quoted")
    title = "当事人邀请您报价"
    require(db.query(Notification.id).filter_by(user_id=lawyer_id, object_type="request", object_id=request.id, title=title).first() is None, "已邀请过该律师，请耐心等待报价", 409, "already_invited")
    notify(db, lawyer_id, title, f"{user.name}邀请您为需求“{request.title}”（{request.region} · {request.service_type}，预算{money(request.budget)}元）提交报价", "request", request.id)
    record_audit(db, user, "request.invited", "request", request.id, {"lawyer_id": lawyer_id}, request_context)


def my_quotes(db: Session, user: User, limit: int = 100) -> list[tuple[Quote, ServiceRequest]]:
    require(user.has_role("lawyer"), "只有律师可以查看报价记录", 403, "forbidden")
    expire_stale_quotes(db)
    return db.query(Quote, ServiceRequest).join(ServiceRequest, ServiceRequest.id == Quote.request_id).filter(Quote.lawyer_id == user.id).order_by(Quote.created_at.desc()).limit(limit).all()


def update_lawyer_profile(db: Session, user: User, payload: LawyerProfileUpdate, request_context: str = "") -> LawyerProfile:
    """律师可自行维护展示资料与接单状态；执业证号、律所等资质字段只能通过重新提交入驻申请变更。"""
    profile = db.query(LawyerProfile).filter_by(user_id=user.id).with_for_update().first()
    require(profile is not None and user.has_role("lawyer"), "请先完成律师入驻", 404, "not_found")
    require(profile.status == "approved" or not payload.available, "资质未生效或已冻结，暂不能开启接单", 409, "invalid_state")
    profile.bio = payload.bio.strip()
    profile.practice_years = payload.practice_years
    profile.specialties = list(dict.fromkeys(item for item in payload.specialties if item and item != profile.field))[:6]
    profile.mode = payload.mode
    if profile.available and not payload.available:
        db.query(Quote).filter_by(lawyer_id=user.id, status="valid").update({"status": "withdrawn", "version": Quote.version + 1}, synchronize_session=False)
    profile.available = payload.available
    record_audit(db, user, "lawyer.profile.updated", "lawyer", user.id, {"available": payload.available}, request_context)
    db.flush()
    return profile


def services_of(db: Session, lawyer_id: str, include_inactive: bool = False) -> list[LawyerService]:
    query = db.query(LawyerService).filter_by(lawyer_id=lawyer_id)
    if not include_inactive:
        query = query.filter(LawyerService.active.is_(True))
    return query.order_by(LawyerService.active.desc(), LawyerService.price).limit(50).all()


def save_service(db: Session, user: User, payload: LawyerServiceIn, service_id: str | None = None, request_context: str = "") -> LawyerService:
    profile = db.get(LawyerProfile, user.id)
    require(user.has_role("lawyer") and profile is not None and profile.status == "approved", "资质审核通过后才能上架服务", 403, "forbidden")
    if service_id:
        service = db.query(LawyerService).filter_by(id=service_id).with_for_update().first()
        require(service is not None and service.lawyer_id == user.id, "服务不存在", 404, "not_found")
    else:
        require(db.query(LawyerService).filter_by(lawyer_id=user.id, active=True).count() < 12, "最多同时上架12个服务", 409, "too_many_services")
        service = LawyerService(id=new_id(), lawyer_id=user.id)
        db.add(service)
    for name in ("title", "service_type", "field", "description", "deliverables", "price", "days", "active"):
        setattr(service, name, getattr(payload, name))
    record_audit(db, user, "lawyer.service.saved", "lawyer_service", service.id, {"price": str(payload.price), "active": payload.active}, request_context)
    db.flush()
    db.refresh(service)
    return service


def purchase_service(db: Session, user: User, service_id: str, payload: ServicePurchase, request_context: str = "") -> Order:
    """一口价委托：以套餐生成定向需求与律师报价，再走与普通报价相同的接受流程（合同确认 → 支付 → 履约）。"""
    require(user.has_role("client"), "只有当事人可以委托服务", 403, "forbidden")
    service = db.get(LawyerService, service_id)
    require(service is not None and service.active, "该服务已下架", 404, "not_found")
    require(service.lawyer_id != user.id, "不能购买本人上架的服务", 403, "self_quote_forbidden")
    lawyer = db.get(User, service.lawyer_id)
    require(active_lawyer(lawyer, db.get(LawyerProfile, service.lawyer_id)), "律师暂停接单，请稍后再试或选择其他律师", 409, "lawyer_unavailable")
    attachments = request_attachments(db, user, payload.attachment_file_ids)
    today = date.today()
    from datetime import timedelta

    request = ServiceRequest(
        id=new_id(), owner_id=user.id, title=service.title, domain="刑事" if service.field in CRIMINAL_FIELDS else "民事",
        field=service.field, service_type=service.service_type, facts=payload.facts, attachments_json=attachments,
        region=payload.region, budget=service.price, deadline=today + timedelta(days=service.days + 7),
        deliverables=service.deliverables, visibility=DIRECT_VISIBILITY, service_id=service.id, status="quoting",
    )
    db.add(request)
    db.flush()
    quote = Quote(
        id=new_id(), request_id=request.id, lawyer_id=service.lawyer_id, scope=service.description,
        deliverables=service.deliverables, price=service.price, days=service.days,
        payment_terms="确认合同后一次性支付", valid_until=today + timedelta(days=3), status="valid",
    )
    db.add(quote)
    record_audit(db, user, "request.created", "request", request.id, {"service_id": service.id}, request_context)
    db.flush()
    order = accept_quote(db, user, quote.id, request_context)
    service.sold += 1
    return order
