#!/usr/bin/env bash
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=runtime_password="$LEGAL_RUNTIME_PASSWORD" <<'SQL'
CREATE ROLE legal_api LOGIN PASSWORD :'runtime_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO legal_api;
GRANT CONNECT ON DATABASE legal_service TO legal_api;
ALTER DEFAULT PRIVILEGES FOR ROLE legal_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO legal_api;
SQL
