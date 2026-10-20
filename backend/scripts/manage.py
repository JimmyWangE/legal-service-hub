import argparse
from datetime import datetime, timezone
import getpass
import hashlib
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
from urllib.parse import unquote, urlparse
from uuid import uuid4


repository = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(repository / "backend"))


def environment(path):
    result = {}
    for line in Path(path).read_text().splitlines():
        if line and not line.startswith("#"):
            name, value = line.split("=", 1)
            result[name] = value
    return result


def admin_sql(statement, database="postgres"):
    result = subprocess.run(["runuser", "-u", "postgres", "--", "/usr/bin/psql", "-h", "/var/lib/legal-service-hub/pgsocket", "-p", "55432", "-d", database, "-v", "ON_ERROR_STOP=1", "-At"], input=statement, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("数据库管理操作失败（错误已脱敏）")
    return result.stdout.strip()


def private_text(path, value):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        stream.write(value)


def dump_arguments(url):
    parsed = urlparse(url)
    return ["-h", parsed.hostname, "-p", str(parsed.port or 5432), "-U", unquote(parsed.username)], {**os.environ, "PGPASSWORD": unquote(parsed.password), "PGCONNECT_TIMEOUT": "5"}, parsed.path.lstrip("/")


parser = argparse.ArgumentParser()
parser.add_argument("action", choices=["migrate", "validate-env", "bootstrap-operator", "create-operator", "verify-email", "deactivate-demo", "backup", "restore-check", "probe", "legacy-upgrade", "reconcile"])
parser.add_argument("--email")
parser.add_argument("--name", default="平台运营管理员")
parser.add_argument("--reason")
parser.add_argument("--file")
parser.add_argument("--date")
parser.add_argument("--provider", choices=["wechatpay", "alipay"])
parser.add_argument("--merchant-id")
parser.add_argument("--i-have-verified-backup", action="store_true")
options = parser.parse_args()
config_path = "/etc/legal-service-hub/migration.env" if options.action in {"migrate", "legacy-upgrade", "backup", "restore-check"} else "/etc/legal-service-hub/api.env"
values = environment(config_path)
os.environ.update(values)

from app.core.config import Settings, get_settings
from app.core.database import SessionLocal
from app.core.security import hash_password
from app.models import User, UserRole
from app.services.common import new_id, record_audit


known = {name.upper() for name in Settings.model_fields}
unknown = set(values) - known
if unknown:
    raise RuntimeError("配置存在未知变量：" + ",".join(sorted(unknown)))
settings = get_settings()

if options.action == "reconcile":
    import json
    from app.services.reconciliation import reconcile_statement

    if not all((options.file, options.date, options.provider, options.merchant_id, options.reason)):
        raise RuntimeError("对账需要 --file --date --provider --merchant-id --reason；只导入已核验来源的规范账单")
    path = Path(options.file).resolve()
    if path.is_symlink() or path.stat().st_size > 20 * 1024 * 1024:
        raise RuntimeError("账单文件无效")
    with SessionLocal.begin() as db:
        result = reconcile_statement(db, path.read_bytes(), options.date, options.provider, options.merchant_id, options.reason)
    print(json.dumps({key: result[key] for key in ("id", "date", "status", "rows", "money_writes")}, ensure_ascii=False))
elif options.action == "validate-env":
    print("配置字段及安全策略校验通过")
elif options.action in {"migrate", "legacy-upgrade"}:
    if options.action == "legacy-upgrade":
        if not options.i_have_verified_backup:
            raise RuntimeError("旧库升级必须先执行并验证备份")
        subprocess.run([str(repository / "backend/.venv/bin/alembic"), "-c", str(repository / "backend/alembic.ini"), "stamp", "20261016_01"], check=True, cwd=repository)
    subprocess.run([str(repository / "backend/.venv/bin/alembic"), "-c", str(repository / "backend/alembic.ini"), "upgrade", "head"], check=True, cwd=repository)
    admin_sql("REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT ALL ON SCHEMA public TO legal_owner; GRANT USAGE ON SCHEMA public TO legal_api; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO legal_api; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO legal_api; ALTER DEFAULT PRIVILEGES FOR ROLE legal_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO legal_api;", "legal_service")
    print("迁移完成；运行账户无建表权限")
elif options.action in {"bootstrap-operator", "create-operator"}:
    with SessionLocal.begin() as db:
        if options.action == "bootstrap-operator" and db.query(UserRole).filter_by(role="operator").first():
            print("运营账户已存在，未修改凭据")
            sys.exit(0)
        email = (options.email or "operator@legal.internal").lower().strip()
        if db.query(User).filter_by(email=email).first():
            raise RuntimeError("邮箱已存在；请核对现有账户，不自动提升权限")
        password = secrets.token_urlsafe(24) if options.action == "bootstrap-operator" else getpass.getpass("设置运营密码：")
        if len(password) < 12:
            raise RuntimeError("运营密码至少12位")
        if options.action == "create-operator" and getpass.getpass("再次输入：") != password:
            raise RuntimeError("两次密码不一致")
        user = User(id=new_id(), email=email, name=options.name, role="operator", password_hash=hash_password(password), email_verified=False, role_grants=[UserRole(role="operator", source="controlled_cli")])
        db.add(user)
        db.flush()
        record_audit(db, user, "operator.provisioned", "user", user.id, {"source": "root_console"})
        if options.action == "bootstrap-operator":
            private_text("/etc/legal-service-hub/initial-admin.txt", f"email={email}\npassword={password}\n仅交付给授权运营；登录后请修改密码。\n")
    print("运营账户已创建；初始凭据仅保存于root私有文件（如使用bootstrap）")
elif options.action == "verify-email":
    if not options.email or not options.reason or len(options.reason) < 8:
        raise RuntimeError("人工邮箱核验必须提供 --email 和至少8字的真实核验依据 --reason")
    with SessionLocal.begin() as db:
        user = db.query(User).filter_by(email=options.email.lower().strip()).with_for_update().one()
        user.email_verified = True
        record_audit(db, None, "email.manually_verified", "user", user.id, {"evidence": options.reason, "source": "root_console"})
    print("人工核验已记录审计")
elif options.action == "deactivate-demo":
    with SessionLocal.begin() as db:
        for identity, email in (("C1", "client@example.com"), ("L1", "lawyer@example.com"), ("A1", "operator@example.com")):
            user = db.query(User).filter_by(id=identity, email=email).first()
            if user:
                user.is_active = False
                record_audit(db, None, "demo.deactivated", "user", user.id)
    print("已停用明确标识的演示账户")
elif options.action == "backup":
    directory = Path("/var/backups/legal-service-hub")
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = directory / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid4().hex[:8] + ".dump")
    arguments, process_env, database = dump_arguments(settings.database_url)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as stream:
        subprocess.run(["pg_dump", *arguments, "-Fc", database], env=process_env, stdout=stream, check=True)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    private_text(str(path) + ".sha256", digest + "\n")
    print(path)
elif options.action == "restore-check":
    if not options.file:
        raise RuntimeError("需要 --file 指定本项目备份")
    path = Path(options.file).resolve()
    if path.parent != Path("/var/backups/legal-service-hub") or hashlib.sha256(path.read_bytes()).hexdigest() != Path(str(path) + ".sha256").read_text().strip():
        raise RuntimeError("备份路径或摘要校验失败")
    name = "legal_restore_" + uuid4().hex[:20]
    admin_sql(f"CREATE DATABASE {name} OWNER legal_owner")
    try:
        arguments, process_env, database = dump_arguments(settings.database_url)
        result = subprocess.run(["pg_restore", *arguments, "-d", name, "--no-owner", "--exit-on-error", str(path)], env=process_env, capture_output=True)
        if result.returncode:
            raise RuntimeError("备份恢复验证失败（错误已脱敏）")
        assert admin_sql("SELECT version_num FROM alembic_version", name) == "20261020_05"
        print("备份摘要及隔离数据库恢复验证通过")
    finally:
        admin_sql(f"DROP DATABASE {name}")
elif options.action == "probe":
    from app.services.health import check_database, check_redis, check_storage, check_model, measured

    import json
    checks = {"database": lambda: check_database(deep=True), "redis": check_redis, "storage": check_storage, "model": check_model}
    result = {name: measured(check) for name, check in checks.items()}
    print(json.dumps(result, ensure_ascii=False))
    if any(item["status"] != "ok" for item in result.values()):
        sys.exit(1)
