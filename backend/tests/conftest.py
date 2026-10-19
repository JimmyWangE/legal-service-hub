import os
import tempfile
from pathlib import Path

import pytest
from sqlalchemy.engine import make_url


test_root = Path(tempfile.mkdtemp(prefix="legal-test-"))
external_url = os.environ.get("DATABASE_URL")
if external_url:
    target = make_url(external_url)
    safe_sqlite = target.drivername.startswith("sqlite") and (target.database or "").startswith(str(test_root))
    safe_postgres = target.drivername.startswith("postgresql") and (target.database or "").startswith("legal_test_") and os.environ.get("LEGAL_ALLOW_TEST_DATABASE_RESET") == "yes"
    if not safe_sqlite and not safe_postgres:
        raise pytest.UsageError("拒绝重建未知数据库；请取消 DATABASE_URL，或显式使用 legal_test_* 专用库并设置 LEGAL_ALLOW_TEST_DATABASE_RESET=yes")

os.environ.update({
    "APP_ENV": "test", "DATABASE_URL": external_url or f"sqlite:///{test_root / 'test.db'}",
    "SEED_DEMO_DATA": "true", "JWT_SECRET": "test-only-secret-not-for-production-123456789",
    "MODEL_PROVIDER": "stub", "MODEL_FALLBACK_TO_STUB": "false",
    "UPLOAD_DIR": str(test_root / "uploads"), "REDIS_URL": "",
    "PAYMENT_PROVIDER": "stub", "PAYMENT_STUB_ENABLED": "true",
    "PAYMENT_STUB_SECRET": "test-webhook-hmac-not-a-production-secret",
    "RATE_LIMIT_PER_MINUTE": "0", "REQUIRE_VERIFIED_EMAIL": "false",
    "HEALTH_MIN_DISK_BYTES": "0",
})
