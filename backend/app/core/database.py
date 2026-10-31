from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


def _engine_kwargs(url: str) -> dict:
    if url.startswith("sqlite"):
        return {"connect_args": {"check_same_thread": False}, "pool_pre_ping": True}
    return {"pool_pre_ping": True, "pool_size": get_settings().database_pool_size, "max_overflow": get_settings().database_max_overflow, "pool_timeout": 2, "connect_args": {"connect_timeout": 2, "options": "-c statement_timeout=10000 -c lock_timeout=3000"}}


settings = get_settings()
if settings.database_url.startswith("sqlite"):
    Path(settings.database_url.replace("sqlite:///", "")).parent.mkdir(parents=True, exist_ok=True)

engine = create_engine(settings.database_url, **_engine_kwargs(settings.database_url))
if settings.database_url.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def configure_sqlite(connection, connection_record):
        connection.isolation_level = None
        connection.execute("PRAGMA busy_timeout=3000")

    @event.listens_for(engine, "begin")
    def begin_sqlite(connection):
        connection.exec_driver_sql("BEGIN")
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
        db.commit()
        db.info.pop("new_files", None)
    except Exception:
        db.rollback()
        for target in db.info.pop("new_files", []):
            target.unlink(missing_ok=True)
        raise
    finally:
        db.close()


def init_db() -> None:
    from app import models  # noqa: F401

    if settings.app_env in {"staging", "production"}:
        return
    Base.metadata.create_all(bind=engine)
    from sqlalchemy import inspect, text

    # 开发库由 create_all 建表，不会补齐已有表的新列；预发布和生产走 Alembic 迁移。
    for table, column, definition in (
        ("users", "avatar_data", "TEXT"), ("chat_messages", "attachment_json", "JSON"),
        ("service_requests", "attachments_json", "JSON NOT NULL DEFAULT '[]'"),
        ("orders", "deliverables", "TEXT NOT NULL DEFAULT ''"), ("orders", "days", "INTEGER NOT NULL DEFAULT 0"),
        ("orders", "payment_terms", "TEXT NOT NULL DEFAULT ''"), ("orders", "client_confirmed_at", "TIMESTAMP"),
        ("orders", "lawyer_confirmed_at", "TIMESTAMP"), ("orders", "closed_reason", "VARCHAR(500) NOT NULL DEFAULT ''"),
        ("orders", "completed_at", "TIMESTAMP"), ("quotes", "payment_terms", "TEXT NOT NULL DEFAULT ''"),
        ("consultations", "category", "VARCHAR(20) NOT NULL DEFAULT 'unsure'"), ("consultations", "intake_json", "JSON"),
        ("after_sales_cases", "resolved_by", "VARCHAR(36)"), ("after_sales_cases", "resolved_at", "TIMESTAMP"),
        ("orders", "service_started_at", "TIMESTAMP"), ("orders", "settled_at", "TIMESTAMP"),
        ("orders", "platform_fee", "NUMERIC(12, 2) NOT NULL DEFAULT 0"), ("service_requests", "service_id", "VARCHAR(36)"),
        ("lawyer_profiles", "bio", "TEXT NOT NULL DEFAULT ''"), ("lawyer_profiles", "practice_years", "INTEGER NOT NULL DEFAULT 0"),
        ("lawyer_profiles", "specialties", "JSON NOT NULL DEFAULT '[]'"),
    ):
        if column not in {item["name"] for item in inspect(engine).get_columns(table)}:
            with engine.begin() as connection:
                connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {definition}"))
    legacy_index = next((item for item in inspect(engine).get_indexes("orders") if item["name"] == "ix_orders_request_id"), None)
    if legacy_index and legacy_index["unique"]:
        with engine.begin() as connection:
            connection.execute(text("DROP INDEX ix_orders_request_id"))
            connection.execute(text("CREATE INDEX ix_orders_request_id ON orders (request_id)"))
            connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_active_request_order ON orders (request_id) WHERE status <> 'cancelled'"))
