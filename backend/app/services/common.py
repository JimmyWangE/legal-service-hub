import hashlib
import json
from decimal import Decimal
from typing import Any
from uuid import uuid4

from sqlalchemy.orm import Session

from app.core.events import emit
from app.core.errors import DomainError
from app.models import AuditLog, Notification, User


def new_id() -> str:
    return str(uuid4())


def stable_hash(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, default=str).encode()
    return hashlib.sha256(encoded).hexdigest()


def money(value: Decimal | float | int) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"))


def record_audit(
    db: Session,
    actor: User | None,
    action: str,
    object_type: str,
    object_id: str,
    detail: dict | None = None,
    request_id: str = "",
    ip: str = "",
) -> None:
    db.add(
        AuditLog(
            id=new_id(),
            actor_id=actor.id if actor else None,
            action=action,
            object_type=object_type,
            object_id=object_id,
            detail_json=detail or {},
            request_id=request_id,
            ip_address=ip,
        )
    )


def notify(db: Session, user_id: str, title: str, body: str, object_type: str = "", object_id: str = "") -> None:
    db.add(
        Notification(
            id=new_id(),
            user_id=user_id,
            title=title,
            body=body,
            object_type=object_type,
            object_id=object_id,
        )
    )


def commit_event(
    db: Session,
    event_type: str,
    aggregate_type: str,
    aggregate_id: str,
    payload: dict,
) -> None:
    emit(db, event_type, aggregate_type, aggregate_id, payload)


def find_or_404(db: Session, model, object_id: str, label: str):
    value = db.get(model, object_id)
    if not value:
        raise DomainError(f"{label}不存在", 404, "not_found")
    return value
