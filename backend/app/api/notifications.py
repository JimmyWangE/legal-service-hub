from app.core.idempotency import TransactionalRouter
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import current_user
from app.core.errors import require
from app.models import Notification

router = TransactionalRouter(prefix="/notifications", tags=["notifications"])


@router.get("")
def list_notifications(offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100), db: Session = Depends(get_db), user=Depends(current_user)):
    return [{"id": item.id, "title": item.title, "body": item.body, "object_type": item.object_type, "object_id": item.object_id, "read_at": item.read_at, "created_at": item.created_at} for item in db.query(Notification).filter_by(user_id=user.id).order_by(Notification.created_at.desc()).offset(offset).limit(limit).all()]


@router.post("/{notification_id}/read")
def mark_read(notification_id: str, db: Session = Depends(get_db), user=Depends(current_user)):
    item = db.query(Notification).filter_by(id=notification_id, user_id=user.id).first()
    require(item is not None, "通知不存在", 404, "not_found")
    item.read_at = datetime.now(timezone.utc)
    db.flush()
    return {"ok": True}
