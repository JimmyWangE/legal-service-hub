import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlparse, urlunparse
from uuid import uuid4


root = Path(__file__).resolve().parents[2]
values = dict(line.split("=", 1) for line in Path("/etc/legal-service-hub/migration.env").read_text().splitlines() if line and not line.startswith("#"))
name = "legal_test_" + uuid4().hex[:20]


def sql(statement):
    result = subprocess.run(["runuser", "-u", "postgres", "--", "psql", "-h", "/var/lib/legal-service-hub/pgsocket", "-p", "55432", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], input=statement, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("隔离测试数据库管理失败")


sql(f"CREATE DATABASE {name} OWNER legal_owner")
try:
    url = urlparse(values["DATABASE_URL"])
    database_url = urlunparse(url._replace(path="/" + name))
    process_env = {**os.environ, "APP_ENV": "test", "DATABASE_URL": database_url, "LEGAL_ALLOW_TEST_DATABASE_RESET": "yes", "PYTHONPATH": str(root / "backend")}
    result = subprocess.run([str(root / "backend/.venv/bin/python"), "-m", "pytest", "backend/tests", "-o", "addopts=", "-q", *sys.argv[1:]], env=process_env, cwd=root)
    status = result.returncode
finally:
    sql(f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{name}' AND pid <> pg_backend_pid()")
    sql(f"DROP DATABASE {name}")
sys.exit(status)
