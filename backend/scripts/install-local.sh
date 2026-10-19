#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" -eq 0
cd /home/lawsft/legal-service-hub
for executable in /usr/bin/postgres /usr/bin/redis-server /usr/bin/initdb; do test -x "$executable"; done
getent passwd legal-api >/dev/null || useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /sbin/nologin legal-api
getent passwd legal-redis >/dev/null || useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /sbin/nologin legal-redis
install -d -o root -g legal-api -m 0750 /etc/legal-service-hub /etc/legal-service-hub/secrets
test -s /home/wjs/deployLLm/.vllm_api_key
install -o root -g legal-api -m 0440 /home/wjs/deployLLm/.vllm_api_key /etc/legal-service-hub/secrets/model-api-key.next
mv -f /etc/legal-service-hub/secrets/model-api-key.next /etc/legal-service-hub/secrets/model-api-key
install -d -o root -g root -m 0755 /var/lib/legal-service-hub
install -d -o legal-api -g legal-api -m 0750 /var/lib/legal-service-hub/uploads
install -d -o legal-api -g legal-api -m 0750 /var/lib/legal-service-hub/metrics
install -d -o legal-redis -g legal-redis -m 0750 /var/lib/legal-service-hub/redis
install -d -o postgres -g postgres -m 0700 /var/lib/legal-service-hub/postgres
install -d -o postgres -g postgres -m 0750 /var/lib/legal-service-hub/pgsocket
if ! test -f /var/lib/legal-service-hub/postgres/PG_VERSION; then
    runuser -u postgres -- /usr/bin/initdb -D /var/lib/legal-service-hub/postgres --auth-local=peer --auth-host=scram-sha-256 --encoding=UTF8 --locale=C >/dev/null
fi
for service in postgres redis worker; do
    install -o root -g root -m 0644 "backend/deploy/legal-service-hub-${service}.service" "/etc/systemd/system/legal-service-hub-${service}.service"
done
install -o root -g root -m 0644 backend/legal-service-hub-api.service /etc/systemd/system/legal-service-hub-api.service
systemctl daemon-reload
systemctl start legal-service-hub-postgres
for attempt in $(seq 1 30); do
    if runuser -u postgres -- pg_isready -h /var/lib/legal-service-hub/pgsocket -p 55432 >/dev/null; then break; fi
    sleep 1
done
backend/.venv/bin/python backend/scripts/configure-local.py
systemctl start legal-service-hub-redis
backend/.venv/bin/python backend/scripts/manage.py migrate
node scripts/build-static.mjs /var/www/legal-service-hub
install -d -o root -g root -m 0755 /etc/systemd/system/legal-service-hub.service.d
install -o root -g root -m 0644 backend/deploy/frontend.conf /etc/systemd/system/legal-service-hub.service.d/production.conf
systemd-analyze verify /etc/systemd/system/legal-service-hub-api.service /etc/systemd/system/legal-service-hub-worker.service
systemctl daemon-reload
systemctl enable --now legal-service-hub-postgres legal-service-hub-redis legal-service-hub-api legal-service-hub-worker
systemctl restart legal-service-hub-api legal-service-hub-worker
systemctl restart legal-service-hub
runuser -u legal-api -- test -r /etc/legal-service-hub/secrets/model-api-key
if runuser -u legal-api -- test -w /etc/legal-service-hub/secrets/model-api-key; then exit 1; fi
if runuser -u nobody -- test -r /etc/legal-service-hub/secrets/model-api-key; then exit 1; fi
echo '内网预发布服务已启动；正式上线仍需受支持的PostgreSQL版本、HTTPS、支付签约和邮件配置。'
