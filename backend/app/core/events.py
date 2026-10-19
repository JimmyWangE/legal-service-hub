import json
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy.orm import Session

from app.models import OutboxEvent


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def emit(
    db: Session,
    event_type: str,
    aggregate_type: str,
    aggregate_id: str,
    payload: dict,
) -> OutboxEvent:
    event = OutboxEvent(
        id=str(uuid4()),
        event_type=event_type,
        aggregate_type=aggregate_type,
        aggregate_id=aggregate_id,
        payload_json=payload,
        created_at=utcnow(),
    )
    db.add(event)
    return event


def publish_pending(db: Session, limit: int = 100) -> int:
    """Local publisher boundary; replace with Kafka/RocketMQ worker in production."""
    pending = (
        db.query(OutboxEvent)
        .filter(OutboxEvent.published_at.is_(None))
        .order_by(OutboxEvent.created_at)
        .limit(limit)
        .all()
    )
    for event in pending:
        event.published_at = utcnow()
    if pending:
        db.commit()
    return len(pending)
