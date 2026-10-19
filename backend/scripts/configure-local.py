import grp
import os
from pathlib import Path
import pwd
import secrets
import subprocess
from urllib.parse import quote, unquote, urlparse


root = Path("/etc/legal-service-hub")
root.mkdir(mode=0o750, exist_ok=True)


def read_environment(path):
    if not path.exists():
        return {}
    return dict(line.split("=", 1) for line in path.read_text().splitlines() if line and not line.startswith("#"))


def private_file(path, content, group="root", mode=0o600):
    temporary = path.with_name(path.name + ".next")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    with os.fdopen(descriptor, "w") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())
    os.chown(temporary, 0, grp.getgrnam(group).gr_gid)
    os.chmod(temporary, mode)
    temporary.replace(path)


api = read_environment(root / "api.env")
owner = read_environment(root / "migration.env")
api_password = unquote(urlparse(api.get("DATABASE_URL", "")).password or "") or secrets.token_urlsafe(36)
owner_password = unquote(urlparse(owner.get("DATABASE_URL", "")).password or "") or secrets.token_urlsafe(36)
redis_password = unquote(urlparse(api.get("REDIS_URL", "")).password or "") or secrets.token_urlsafe(36)
values = {
    "APP_ENV": "staging", "DATABASE_URL": f"postgresql+psycopg://legal_api:{quote(api_password, safe='')}@127.0.0.1:55432/legal_service",
    "REDIS_URL": f"redis://legal_api:{quote(redis_password, safe='')}@127.0.0.1:56379/0", "JWT_SECRET": api.get("JWT_SECRET") or secrets.token_urlsafe(48),
    "CORS_ORIGINS": "http://172.22.3.76:189", "SEED_DEMO_DATA": "false", "UPLOAD_DIR": "/var/lib/legal-service-hub/uploads",
    "MODEL_PROVIDER": "openai_compatible", "MODEL_BASE_URL": "http://172.22.3.76:180/v1", "MODEL_API_KEY_FILE": "/etc/legal-service-hub/secrets/model-api-key",
    "MODEL_NAME": "Qwen3.8-27B", "MODEL_TIMEOUT_SECONDS": "180", "MODEL_MAX_TOKENS": "2000", "MODEL_ENABLE_THINKING": "false", "MODEL_FALLBACK_TO_STUB": "false",
    "PAYMENT_PROVIDER": "disabled", "PAYMENT_STUB_ENABLED": "false", "REQUIRE_VERIFIED_EMAIL": "true", "ALLOW_RATE_LIMIT_FALLBACK": "false",
    "PROMETHEUS_MULTIPROC_DIR": "/var/lib/legal-service-hub/metrics",
}
values.update(api)
private_file(root / "api.env", "\n".join(f"{name}={value}" for name, value in values.items()) + "\n")
private_file(root / "migration.env", "\n".join(f"{name}={value}" for name, value in {**values, "DATABASE_URL": f"postgresql+psycopg://legal_owner:{quote(owner_password, safe='')}@127.0.0.1:55432/legal_service"}.items()) + "\n")
redis_root = Path("/etc/legal-service-hub-redis")
redis_root.mkdir(mode=0o750, exist_ok=True)
os.chown(redis_root, 0, grp.getgrnam("legal-redis").gr_gid)
private_file(redis_root / "redis.conf", f"bind 127.0.0.1\nport 56379\nprotected-mode yes\ndir /var/lib/legal-service-hub/redis\nappendonly yes\nappendfsync everysec\nsave 900 1\nmaxmemory 256mb\nmaxmemory-policy noeviction\nuser default off\nuser legal_api on >{redis_password} ~* +ping +get +set +del +ttl +incr +expire +eval +zadd +zrem +zcard +zremrangebyscore +select +client|setname\n", "legal-redis", 0o640)


def postgres_sql(statement):
    result = subprocess.run(["runuser", "-u", "postgres", "--", "/usr/bin/psql", "-h", "/var/lib/legal-service-hub/pgsocket", "-p", "55432", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], input=statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError("隔离数据库初始化失败；请检查服务状态，未输出含密码SQL")
    return result.stdout.strip()


for name, password in (("legal_owner", owner_password), ("legal_api", api_password)):
    escaped = password.replace("'", "''")
    postgres_sql(f"DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{name}') THEN CREATE ROLE {name} LOGIN; END IF; END $$; ALTER ROLE {name} WITH PASSWORD '{escaped}' NOSUPERUSER NOCREATEDB NOCREATEROLE;")
if postgres_sql("SELECT 1 FROM pg_database WHERE datname = 'legal_service'") != "1":
    postgres_sql("CREATE DATABASE legal_service OWNER legal_owner")
print("隔离数据库及受控配置已准备（未输出任何密钥）")
