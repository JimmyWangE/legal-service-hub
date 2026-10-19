from app.core.idempotency import TransactionalRouter
import hashlib
import json

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.orm import Session

from app.api.serializers import consultation_out
from app.core.database import get_db
from app.core.deps import current_user, request_context
from app.models import Consultation, ConsultationMessage, IdempotencyRecord
from app.schemas import ConsultationCreate, FeedbackCreate, MessageCreate, SummaryCreate
from app.services import consultation
from app.services.common import new_id

router = TransactionalRouter(prefix="/consultations", tags=["consultations"])
stream_router = APIRouter(prefix="/consultations", tags=["consultations"])


def require_model_ready(request: Request):
    from app.core.config import get_settings
    from app.core.errors import require

    if get_settings().app_env in {"staging", "production"}:
        require(request.app.state.health.snapshot(model_required=True)[0] == 200, "模型咨询暂不可用，订单等核心业务仍可访问", 503, "model_unavailable")


@router.post("")
def create(payload: ConsultationCreate, db: Session = Depends(get_db), user=Depends(current_user)):
    return consultation_out(db, consultation.create(db, user.id, payload.topic, payload.title))


@router.get("")
def list_consultations(offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100), db: Session = Depends(get_db), user=Depends(current_user)):
    items = db.query(Consultation).filter(Consultation.owner_id == user.id).order_by(Consultation.updated_at.desc()).offset(offset).limit(limit).all()
    return [{"id": item.id, "topic": item.topic, "title": item.title, "status": item.status, "updated_at": item.updated_at, "created_at": item.created_at} for item in items]


@router.get("/{consultation_id}")
def get(consultation_id: str, db: Session = Depends(get_db), user=Depends(current_user)):
    return consultation_out(db, consultation.get_owned(db, consultation_id, user.id))


@router.get("/{consultation_id}/messages")
def message_history(consultation_id: str, before_sequence: int | None = Query(None, ge=1), limit: int = Query(100, ge=1, le=200), db: Session = Depends(get_db), user=Depends(current_user)):
    consultation.get_owned(db, consultation_id, user.id)
    query = db.query(ConsultationMessage).filter_by(consultation_id=consultation_id)
    if before_sequence:
        query = query.filter(ConsultationMessage.sequence < before_sequence)
    return [{"id": item.id, "role": item.role, "text": item.text, "sequence": item.sequence, "source": item.source, "created_at": item.created_at} for item in query.order_by(ConsultationMessage.sequence.desc()).limit(limit).all()[::-1]]


@router.post("/{consultation_id}/messages", dependencies=[Depends(require_model_ready)])
def message(consultation_id: str, payload: MessageCreate, db: Session = Depends(get_db), user=Depends(current_user), context=Depends(request_context)):
    current = consultation.get_owned(db, consultation_id, user.id)
    consultation.add_message(db, current, user, payload, context["request_id"])
    return consultation_out(db, current)


@stream_router.post("/{consultation_id}/messages/stream")
def stream_message_endpoint(
    consultation_id: str,
    payload: MessageCreate,
    request: Request,
    db: Session = Depends(get_db),
    user=Depends(current_user),
    context=Depends(request_context),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    require_model_ready(request)
    current = consultation.get_owned(db, consultation_id, user.id)
    prepared = consultation.prepare_message(db, current, user, payload)
    record = None
    if idempotency_key:
        from app.core.errors import require

        require(len(idempotency_key) <= 128 and idempotency_key.isascii() and idempotency_key.isprintable(), "幂等键格式不正确", 422, "invalid_idempotency_key")
        scope = hashlib.sha256(f"POST:{request.url.path}:{idempotency_key}".encode()).hexdigest()
        body_hash = hashlib.sha256(json.dumps(payload.model_dump(mode="json"), ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        record = db.query(IdempotencyRecord).filter_by(actor_id=user.id, key=scope).first()
        if record:
            require(record.request_hash == body_hash, "幂等键不能复用到不同请求", 409, "idempotency_conflict")
            require(record.status_code != 0, "请求仍在处理中，请等待模型结果", 409, "idempotency_in_progress")
            return JSONResponse(content=record.response_json)
        record = IdempotencyRecord(id=new_id(), actor_id=user.id, key=scope, request_hash=body_hash, status_code=0, response_json={})
        db.add(record)
        db.flush()
        db.commit()
    return StreamingResponse(
        consultation.stream_message(consultation_id, user.id, payload, context["request_id"], prepared, record.id if record else None),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@router.post("/{consultation_id}/feedback")
def feedback(consultation_id: str, payload: FeedbackCreate, db: Session = Depends(get_db), user=Depends(current_user)):
    current = consultation.get_owned(db, consultation_id, user.id)
    item = consultation.add_feedback(db, current, user.id, payload.message_id, payload.value, payload.reason)
    return {"id": item.id, "message_id": item.message_id, "value": item.value, "reason": item.reason}


@router.post("/{consultation_id}/summary")
def summary(consultation_id: str, payload: SummaryCreate, db: Session = Depends(get_db), user=Depends(current_user)):
    current = consultation.get_owned(db, consultation_id, user.id)
    snapshot, consent = consultation.create_summary(db, current, user.id, payload)
    return {"consultation_id": current.id, "summary": snapshot, "consent_id": consent.id}
