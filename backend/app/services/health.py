import asyncio
import os
import random
import shutil
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import httpx
from sqlalchemy import text

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.core.errors import DomainError
from app.services.model_provider import get_model_provider


SCHEMA_REVISION = "20261031_08"


def check_database(deep=False):
    details = {}
    with SessionLocal() as db:
        if db.bind.dialect.name == "postgresql":
            db.execute(text("SET LOCAL statement_timeout = '1800ms'"))
        db.execute(text("SELECT 1"))
        if get_settings().app_env in {"staging", "production"}:
            schema_revision = db.execute(text("SELECT version_num FROM alembic_version")).scalar()
            assert schema_revision == SCHEMA_REVISION
            details["schema_revision"] = schema_revision
            version = int(db.execute(text("SHOW server_version_num")).scalar())
            if version < 140000:
                if get_settings().app_env == "production":
                    raise DomainError("数据库需升级至受支持版本", 503, "postgresql_upgrade_required")
                details.update(warning="postgresql_upgrade_required", server_major=version // 10000)
        if deep:
            from app.models import HealthProbe

            probe = HealthProbe(id=str(uuid4()), value="synthetic")
            db.add(probe)
            db.flush()
            assert db.get(HealthProbe, probe.id).value == "synthetic"
            db.rollback()
    return details


def redis_client():
    import redis

    return redis.Redis.from_url(get_settings().redis_url, socket_connect_timeout=0.5, socket_timeout=0.5, decode_responses=True)


def check_redis():
    settings = get_settings()
    if not settings.redis_url:
        if settings.app_env == "production":
            raise DomainError("Redis未配置", 503, "redis_unconfigured")
        return {"mode": "development_memory"}
    client = redis_client()
    key = f"health:{settings.app_env}:{uuid4()}"
    try:
        assert client.ping()
        client.set(key, "ok", ex=15)
        assert client.get(key) == "ok" and 0 < client.ttl(key) <= 15
    finally:
        try:
            client.delete(key)
        finally:
            client.close()


def check_storage():
    root = Path(get_settings().upload_dir)
    directory = root / ".health"
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / uuid4().hex
    data = os.urandom(32)
    try:
        with target.open("xb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        assert target.read_bytes() == data
        assert shutil.disk_usage(root).free >= get_settings().health_min_disk_bytes
    finally:
        target.unlink(missing_ok=True)


def check_model():
    settings = get_settings()
    if settings.model_provider == "stub":
        return {"mode": "test_stub"}
    provider = get_model_provider()
    with httpx.Client(base_url=provider.base_url, headers=provider.headers, trust_env=False, timeout=3) as client:
        response = client.get("models")
        response.raise_for_status()
        assert any(item["id"] == settings.model_name for item in response.json()["data"])
    if settings.redis_url:
        with redis_client() as client:
            state = client.get("health:model:generation")
        if state == "failed":
            raise DomainError("模型生成巡检失败", 503, "model_generation_unavailable")
        if state is None and settings.app_env in {"staging", "production"}:
            raise DomainError("模型生成巡检待执行", 503, "model_generation_unchecked")


def measured(check):
    started = time.monotonic()
    result = {"status": "ok", "checked_at": datetime.now(timezone.utc).isoformat()}
    try:
        result.update(check() or {})
    except Exception as exc:
        result.update(status="failed", error_code=exc.code if isinstance(exc, DomainError) else "dependency_unavailable")
    result["latency_ms"] = round((time.monotonic() - started) * 1000, 2)
    return result


class HealthMonitor:
    def __init__(self):
        self.executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="health")
        self.futures = {}
        self.components = {}
        self.checked_monotonic = 0
        self.task = None

    async def collect(self):
        checks = {"database": check_database, "redis": check_redis, "storage": check_storage, "model": check_model}
        pending = {}
        for name, check in checks.items():
            future = self.futures.get(name)
            if future is not None and not future.done():
                self.components[name] = {"status": "failed", "error_code": "probe_timeout"}
                continue
            future = self.executor.submit(measured, check)
            self.futures[name] = future
            pending[name] = asyncio.wrap_future(future)
        if pending:
            await asyncio.wait(pending.values(), timeout=get_settings().health_timeout_seconds)
        for name, future in pending.items():
            self.components[name] = future.result() if future.done() else {"status": "failed", "error_code": "probe_timeout"}
        self.checked_monotonic = time.monotonic()

    async def run(self):
        while True:
            await self.collect()
            await asyncio.sleep(get_settings().health_interval_seconds + random.uniform(0, 0.5))

    def start(self):
        self.task = asyncio.create_task(self.run())

    async def stop(self):
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
        self.executor.shutdown(wait=False, cancel_futures=True)

    def snapshot(self, model_required=False):
        components = dict(self.components)
        stale = not self.checked_monotonic or time.monotonic() - self.checked_monotonic > get_settings().health_stale_seconds
        required = ["database", "redis", "storage"]
        if model_required or get_settings().ready_require_model:
            required.append("model")
        ready = not stale and all(components.get(name, {}).get("status") == "ok" for name in required)
        model_ok = not stale and components.get("model", {}).get("status") == "ok"
        return (200 if ready else 503), {"status": "ready" if ready and model_ok else "degraded" if ready else "not_ready", "stale": stale, "components": components, "capabilities": {"core": ready, "consultation": ready and model_ok}}
