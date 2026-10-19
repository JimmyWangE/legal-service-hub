from decimal import Decimal

from sqlalchemy.orm import Session, defer

from app.models import (
    AfterSalesCase,
    Consultation,
    ConsultationMessage,
    ConsultationFeedback,
    Document,
    DocumentVersion,
    LawyerProfile,
    Order,
    Payment,
    Quote,
    ServiceRequest,
    User,
    WorkflowTask,
)


def user_out(user: User) -> dict:
    return {"id": user.id, "email": user.email, "name": user.name, "role": user.role, "roles": user.roles, "email_verified": user.email_verified, "org_id": user.org_id}


def consultation_out(db: Session, consultation: Consultation) -> dict:
    messages = db.query(ConsultationMessage).filter_by(consultation_id=consultation.id).order_by(ConsultationMessage.sequence.desc()).limit(200).all()[::-1]
    feedback = {item.message_id: item.value for item in db.query(ConsultationFeedback).filter_by(consultation_id=consultation.id, user_id=consultation.owner_id).all()}
    return {
        "feedbackByMessage": {index: feedback[message.id] for index, message in enumerate(messages) if message.id in feedback},
        "id": consultation.id,
        "topic": consultation.topic,
        "title": consultation.title,
        "status": consultation.status,
        "version": consultation.version,
        "risk_level": consultation.risk_level,
        "summary": consultation.summary_json,
        "created_at": consultation.created_at,
        "updated_at": consultation.updated_at,
        "messages": [
            {"id": m.id, "role": m.role, "text": m.text, "sequence": m.sequence, "source": m.source, "attachments": m.attachments_json, "risk": m.risk, "created_at": m.created_at}
            for m in messages
        ],
    }


def request_out(request: ServiceRequest) -> dict:
    return {
        "id": request.id, "owner_id": request.owner_id, "source_consultation_id": request.source_consultation_id,
        "title": request.title, "domain": request.domain, "field": request.field,
        "service_type": request.service_type, "facts": request.facts, "region": request.region,
        "budget": request.budget, "deadline": request.deadline, "deliverables": request.deliverables,
        "visibility": request.visibility, "status": request.status, "version": request.version,
        "created_at": request.created_at,
    }


def lawyer_out(profile: LawyerProfile, user: User, private: bool = False) -> dict:
    result = {"id": user.id, "name": user.name, "firm": profile.firm, "region": profile.region, "field": profile.field, "mode": profile.mode, "status": profile.status, "available": profile.available, "expires_on": profile.expires_on}
    if private:
        result.update(email=user.email, license_number=profile.license_number)
    return result


def quote_out(quote: Quote) -> dict:
    return {"id": quote.id, "request_id": quote.request_id, "lawyer_id": quote.lawyer_id, "scope": quote.scope, "deliverables": quote.deliverables, "price": quote.price, "days": quote.days, "valid_until": quote.valid_until, "status": quote.status, "version": quote.version, "created_at": quote.created_at}


def order_out(order: Order) -> dict:
    return {"id": order.id, "request_id": order.request_id, "quote_id": order.quote_id, "client_id": order.client_id, "lawyer_id": order.lawyer_id, "title": order.title, "scope": order.scope, "price": order.price, "paid": order.paid, "status": order.status, "payment_status": order.payment_status, "settlement_status": order.settlement_status, "version": order.version, "created_at": order.created_at, "updated_at": order.updated_at}


def payment_out(payment: Payment) -> dict:
    return {"id": payment.id, "order_id": payment.order_id, "provider": payment.provider, "intent_id": payment.intent_id, "amount": payment.amount, "status": payment.status, "client_params": payment.client_params, "expires_at": payment.expires_at, "created_at": payment.created_at}


def document_out(db: Session, document: Document, include_body: bool = True) -> dict:
    versions = db.query(DocumentVersion).options(defer(DocumentVersion.body)).filter_by(document_id=document.id).order_by(DocumentVersion.number.desc()).limit(50).all()[::-1]
    tasks = db.query(WorkflowTask).filter_by(document_id=document.id).order_by(WorkflowTask.sequence).all()
    output = {"id": document.id, "order_id": document.order_id, "owner_id": document.owner_id, "title": document.title, "doc_type": document.doc_type, "status": document.status, "current_version": document.current_version, "locked_version": document.locked_version, "members": document.members_json, "created_at": document.created_at, "versions": [{"id": v.id, "number": v.number, "author_id": v.author_id, "body_hash": v.body_hash, "body": v.body if include_body and v.number == document.current_version else None, "created_at": v.created_at} for v in versions], "workflow": [{"id": t.id, "version": t.version_number, "sequence": t.sequence, "assignee_id": t.assignee_id, "status": t.status, "reason": t.reason} for t in tasks]}
    return output


def case_out(case: AfterSalesCase) -> dict:
    return {"id": case.id, "order_id": case.order_id, "created_by": case.created_by, "case_type": case.case_type, "reason": case.reason, "amount": case.amount, "status": case.status, "resolution": case.resolution, "created_at": case.created_at}


def application_out(db, application):
    from app.models import LawyerReviewRecord

    result = {name: getattr(application, name) for name in ("id", "user_id", "version", "firm", "region", "field", "mode", "license_number", "expires_on", "credential_file_ids", "status", "created_at")}
    result["reviews"] = [{"decision": item.decision, "reason": item.reason, "version": item.version, "created_at": item.created_at} for item in db.query(LawyerReviewRecord).filter_by(application_id=application.id).order_by(LawyerReviewRecord.created_at).limit(100).all()]
    return result
