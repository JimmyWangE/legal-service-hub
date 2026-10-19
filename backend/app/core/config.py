import os
from functools import lru_cache
from pathlib import Path

from pydantic import ValidationError, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Legal Service Hub API"
    app_env: str = "development"
    database_url: str = "sqlite:///./backend/data/legal_service.db"
    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 30
    refresh_token_days: int = 14
    cors_origins: str = "http://127.0.0.1:4173,http://localhost:4173"
    redis_url: str | None = None
    rate_limit_per_minute: int = 120
    upload_dir: str = "backend/data/uploads"
    max_upload_bytes: int = 50 * 1024 * 1024
    model_provider: str = "stub"
    model_base_url: str = "http://127.0.0.1:8000/v1"
    model_api_key_file: str = ""
    model_name: str = ""
    model_timeout_seconds: float = 180.0
    model_max_tokens: int = 2000
    model_enable_thinking: bool = False
    model_temperature: float = 0.2
    model_fallback_to_stub: bool = False
    seed_demo_data: bool = True
    payment_provider: str = "disabled"
    payment_stub_enabled: bool = False
    payment_stub_secret: str = ""
    payment_timestamp_tolerance_seconds: int = 300
    payment_max_body_bytes: int = 65536
    wechatpay_mch_id: str = ""
    wechatpay_app_id: str = ""
    wechatpay_mch_serial_no: str = ""
    wechatpay_private_key_file: str = ""
    wechatpay_api_v3_key_file: str = ""
    wechatpay_verify_keys_dir: str = ""
    wechatpay_notify_url: str = ""
    alipay_app_id: str = ""
    alipay_seller_id: str = ""
    alipay_private_key_file: str = ""
    alipay_public_key_file: str = ""
    alipay_notify_url: str = ""
    alipay_gateway: str = "https://openapi.alipay.com/gateway.do"
    alipay_notify_max_age_hours: int = 26
    payment_timeout_seconds: float = 8
    ready_require_model: bool = False
    health_interval_seconds: float = 5
    health_stale_seconds: float = 15
    health_timeout_seconds: float = 4
    health_min_disk_bytes: int = 104857600
    health_synthetic_seconds: float = 300
    model_max_concurrency: int = 8
    database_pool_size: int = 8
    database_max_overflow: int = 8
    allow_rate_limit_fallback: bool = False
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password_file: str = ""
    smtp_from: str = ""
    public_base_url: str = ""
    require_verified_email: bool = False
    prometheus_multiproc_dir: str = ""

    model_config = SettingsConfigDict(
        env_file=("backend/.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    @model_validator(mode="after")
    def validate_production(self):
        if self.payment_provider not in {"disabled", "stub", "wechatpay", "alipay"}:
            raise ValueError("unsupported PAYMENT_PROVIDER")
        if self.app_env not in {"staging", "production"}:
            return self
        if len(self.jwt_secret) < 32 or self.jwt_secret in {"change-me", "test-secret"}:
            raise ValueError("production requires a strong JWT_SECRET")
        if not self.database_url.startswith("postgresql") or not self.redis_url:
            raise ValueError("production requires PostgreSQL and Redis")
        if self.seed_demo_data or self.model_provider == "stub" or self.model_fallback_to_stub:
            raise ValueError("production forbids demo seeding and model stubs")
        if self.app_env == "production" and (self.payment_provider == "stub" or self.payment_stub_enabled):
            raise ValueError("production forbids payment stubs")
        if "*" in self.cors_origin_list or self.allow_rate_limit_fallback:
            raise ValueError("production forbids wildcard CORS and implicit rate-limit fallback")
        if not Path(self.upload_dir).is_absolute() or not self.model_name:
            raise ValueError("production requires absolute storage path and explicit model name")
        if not self.model_api_key_file or not Path(self.model_api_key_file).is_file():
            raise ValueError("model credential file unavailable")
        try:
            if not Path(self.model_api_key_file).read_text().strip():
                raise ValueError("empty model credential")
        except OSError as exc:
            raise ValueError("model credential unreadable") from exc
        if self.payment_provider == "stub":
            if not self.payment_stub_enabled or len(self.payment_stub_secret) < 32:
                raise ValueError("staging simulation payment requires a strong stub secret")
        elif self.payment_provider != "disabled":
            prefix = "wechatpay" if self.payment_provider == "wechatpay" else "alipay"
            required = ("mch_id", "app_id", "mch_serial_no", "private_key_file", "api_v3_key_file", "verify_keys_dir", "notify_url") if prefix == "wechatpay" else ("app_id", "seller_id", "private_key_file", "public_key_file", "notify_url")
            if any(not getattr(self, f"{prefix}_{name}") for name in required):
                raise ValueError("payment merchant configuration incomplete")
            if not getattr(self, f"{prefix}_notify_url").startswith("https://"):
                raise ValueError("payment callback requires HTTPS")
            for name in required:
                if name.endswith("_file"):
                    path = Path(getattr(self, f"{prefix}_{name}"))
                    if not path.is_file() or not os.access(path, os.R_OK) or not path.stat().st_size:
                        raise ValueError("payment credential file unavailable")
            if prefix == "wechatpay" and not any(Path(self.wechatpay_verify_keys_dir).glob("*.pem")):
                raise ValueError("trusted payment verification keys unavailable")
        if self.app_env == "production" and not self.public_base_url.startswith("https://"):
            raise ValueError("production requires a public HTTPS base URL")
        if self.rate_limit_per_minute <= 0 or self.model_max_concurrency <= 0 or self.database_pool_size <= 0:
            raise ValueError("deployed rate and concurrency limits must be positive")
        return self


@lru_cache
def get_settings() -> Settings:
    if os.getenv("APP_ENV") in {"staging", "production"}:
        prefixes = ("APP_", "MODEL_", "PAYMENT_", "WECHATPAY_", "ALIPAY_", "DATABASE_", "JWT_", "SEED_DEMO_", "REDIS_", "SMTP_", "UPLOAD_", "MAX_UPLOAD_", "CORS_", "ACCESS_TOKEN_", "REFRESH_TOKEN_", "RATE_LIMIT_", "READY_", "HEALTH_", "ALLOW_RATE_", "REQUIRE_VERIFIED_", "PUBLIC_BASE_", "PROMETHEUS_")
        known = {name.upper() for name in Settings.model_fields}
        unknown = {name for name in os.environ if name.startswith(prefixes) and name not in known}
        if unknown:
            raise RuntimeError("安全配置包含未知变量：" + ",".join(sorted(unknown)))
    env_files = None if os.getenv("APP_ENV") in {"staging", "production"} else ("backend/.env", ".env")
    try:
        return Settings(_env_file=env_files)
    except ValidationError as exc:
        messages = "; ".join(item["msg"] for item in exc.errors(include_input=False, include_context=False))
        raise RuntimeError("安全配置校验失败：" + messages) from None
