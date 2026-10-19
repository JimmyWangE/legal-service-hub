from datetime import date, datetime, timedelta, timezone
import hashlib
import json
import logging
import signal
import time
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import text

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.core.errors import DomainError
from app.models import AuditLog, LawyerProfile, Notification, OutboxEvent, Payment, PaymentTransaction, PaymentWebhookInbox, Refund
from app.services.common import notify, record_audit
from app.services.health import check_database, check_redis, check_storage, redis_client
from app.services.model_provider import get_model_provider
from app.services.payments import process_inbox_once, synchronize_payment, synchronize_refund


logger = logging.getLogger("legal.worker")
running = True


def run_task(model, identity, operation):
    try:
        with SessionLocal.begin() as db:
            if db.bind.dialect.name == "postgresql":
                lock_id = int.from_bytes(hashlib.sha256(f"{model.__tablename__}:{identity}".encode()).digest()[:8], "big", signed=True)
                if not db.execute(text("SELECT pg_try_advisory_xact_lock(:identity)"), {"identity": lock_id}).scalar():
                    return
            operation(db, identity)
    except Exception as exc:
        code = exc.code if isinstance(exc, DomainError) else "worker_task_failed"
        logger.warning("task_retry type=%s id=%s code=%s", model.__tablename__, identity, code)
        with SessionLocal.begin() as db:
            item = db.query(model).filter_by(id=identity).with_for_update().first()
            if item and item.status not in {"processed", "success", "closed"}:
                item.attempts += 1
                item.next_attempt_at = datetime.now(timezone.utc) + timedelta(seconds=min(300, 2 ** min(item.attempts, 8)))
                if model == PaymentWebhookInbox:
                    item.error_code = code
                    item.status = "manual_review" if item.attempts >= 10 else "retry"


def tick():
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        inbox = [item.id for item in db.query(PaymentWebhookInbox).filter(PaymentWebhookInbox.status.in_(["pending", "retry"]), PaymentWebhookInbox.next_attempt_at <= now).order_by(PaymentWebhookInbox.created_at).limit(50).all()]
        payments = [item.id for item in db.query(Payment).filter(Payment.status.in_(["creating", "created"]), Payment.next_attempt_at <= now, Payment.provider != "stub").limit(20).all()]
        refunds = [item.id for item in db.query(Refund).filter(Refund.status.in_(["pending", "processing"]), Refund.next_attempt_at <= now).limit(20).all()]
    for identity in inbox:
        run_task(PaymentWebhookInbox, identity, lambda db, identifier: process_inbox_once(db, identifier))
    for identity in payments:
        run_task(Payment, identity, synchronize_payment)
    for identity in refunds:
        run_task(Refund, identity, synchronize_refund)


def synthetic_checks():
    settings = get_settings()
    if not settings.redis_url:
        return
    with redis_client() as client:
        interval = max(30, int(settings.health_synthetic_seconds))
        if not client.set("health:synthetic:lease", "worker", nx=True, ex=interval):
            return
        states = {}
        for name, operation in {"database": lambda: check_database(deep=True), "redis": check_redis, "storage": check_storage, "model": lambda: get_model_provider().probe()}.items():
            try:
                operation()
                states[name] = "ok"
            except Exception:
                states[name] = "failed"
                logger.error("synthetic_failed component=%s", name)
        client.set("health:model:generation", states["model"], ex=interval * 3)
        client.set("health:synthetic:status", json.dumps({"components": states, "checked_at": datetime.now(timezone.utc).isoformat()}), ex=interval * 3)


def license_reminders():
    with SessionLocal.begin() as db:
        profiles = db.query(LawyerProfile).filter(LawyerProfile.status == "approved", LawyerProfile.expires_on <= date.today() + timedelta(days=30)).all()
        for profile in profiles:
            marker = f"license-expiry:{profile.user_id}:{profile.expires_on}"
            if db.query(Notification).filter_by(user_id=profile.user_id, object_type="license_expiry", object_id=marker).first():
                continue
            notify(db, profile.user_id, "执业证有效期提醒", f"执业证有效期为{profile.expires_on}；过期后停止新接单，请更新资质申请。", "license_expiry", marker)


def stop(signum, frame):
    global running
    running = False


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    last_reminder = 0
    probe_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="synthetic")
    probe_future = None
    while running:
        try:
            tick()
            if probe_future is None or probe_future.done():
                probe_future = probe_executor.submit(synthetic_checks)
            if time.monotonic() - last_reminder >= 3600:
                license_reminders()
                last_reminder = time.monotonic()
        except Exception:
            logger.error("worker_cycle_failed")
        time.sleep(1)
    probe_executor.shutdown(wait=True)


if __name__ == "__main__":
    main()
