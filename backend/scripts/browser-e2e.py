import base64
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import tempfile
import time
from urllib.parse import urlparse, urlunparse
from uuid import uuid4

import httpx
from playwright.sync_api import expect, sync_playwright
import psycopg


root = Path(__file__).resolve().parents[2]
output = root / "test-results"
output.mkdir(exist_ok=True)
temporary = Path(tempfile.mkdtemp(prefix="legal-browser-"))
values = dict(line.split("=", 1) for line in Path("/etc/legal-service-hub/migration.env").read_text().splitlines() if line and not line.startswith("#"))
database_name = "legal_test_browser_" + uuid4().hex[:12]
url = urlparse(values["DATABASE_URL"])
database_url = urlunparse(url._replace(path="/" + database_name))
dsn = database_url.replace("postgresql+psycopg://", "postgresql://", 1)
records = []
page_errors = []
processes = []
report = {"environment": "isolated_postgresql_and_test_model", "mocked_business_apis": False, "started_at": datetime.now(timezone.utc).isoformat(), "cases": []}


def sql(statement):
    result = subprocess.run(["runuser", "-u", "postgres", "--", "psql", "-h", "/var/lib/legal-service-hub/pgsocket", "-p", "55432", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], input=statement, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("测试数据库操作失败")


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def passed(name):
    report["cases"].append({"name": name, "status": "passed"})
    print("PASS", name, flush=True)


def wait_ready(endpoint):
    with httpx.Client(trust_env=False) as client:
        for attempt in range(100):
            try:
                if client.get(endpoint, timeout=1).status_code == 200:
                    return
            except httpx.HTTPError:
                pass
            time.sleep(0.1)
    raise RuntimeError("测试服务启动超时")


def idle(page):
    page.wait_for_load_state("networkidle")
    expect(page.locator('.page-body [aria-busy="true"]')).to_have_count(0)
    expect(page.locator('.page-body section[role="alert"]')).to_have_count(0)


def go(page, target):
    destination = base + "/#/" + target
    if page.url == destination:
        page.locator('[data-action="refresh"]').first.click()
    else:
        page.goto(destination)
    idle(page)


def submit(page, name):
    page.locator(f'form[data-form="{name}"] button[type="submit"]').click()


def login(page, email, password):
    page.goto(base)
    page.locator('[name="email"]').fill(email)
    page.locator('[name="password"]').fill(password)
    submit(page, "login")
    expect(page.locator(".platform-shell")).to_be_visible()
    idle(page)


def token(client, email, password):
    response = client.post(base + "/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    return {"Authorization": "Bearer " + response.json()["access_token"]}


sql(f"CREATE DATABASE {database_name} OWNER legal_owner")
try:
    api_port, web_port = free_port(), free_port()
    base = f"http://127.0.0.1:{web_port}"
    process_env = {**os.environ, "APP_ENV": "test", "DATABASE_URL": database_url, "SEED_DEMO_DATA": "true", "MODEL_PROVIDER": "stub", "MODEL_FALLBACK_TO_STUB": "false", "JWT_SECRET": "browser-only-" + uuid4().hex, "PAYMENT_PROVIDER": "stub", "PAYMENT_STUB_ENABLED": "true", "PAYMENT_STUB_SECRET": "browser-webhook-" + uuid4().hex, "UPLOAD_DIR": str(temporary / "uploads"), "REDIS_URL": "", "RATE_LIMIT_PER_MINUTE": "0", "REQUIRE_VERIFIED_EMAIL": "false", "HEALTH_MIN_DISK_BYTES": "0", "PYTHONPATH": str(root / "backend")}
    subprocess.run([str(root / "backend/.venv/bin/python"), "-c", "from app.core.database import init_db, SessionLocal; from app.bootstrap import seed_demo_data; init_db(); database=SessionLocal(); seed_demo_data(database); database.close()"], env=process_env, cwd=root, check=True)
    api_log = (temporary / "api.log").open("w")
    web_log = (temporary / "web.log").open("w")
    processes.append(subprocess.Popen([str(root / "backend/.venv/bin/python"), "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(api_port), "--workers", "2"], cwd=root, env=process_env, stdout=api_log, stderr=subprocess.STDOUT, start_new_session=True))
    wait_ready(f"http://127.0.0.1:{api_port}/health/ready")
    subprocess.run(["node", "scripts/build-static.mjs", str(temporary / "public")], cwd=root, check=True, stdout=subprocess.DEVNULL)
    processes.append(subprocess.Popen(["node", "server.mjs"], cwd=root, env={**os.environ, "PORT": str(web_port), "HOST": "127.0.0.1", "API_UPSTREAM": f"http://127.0.0.1:{api_port}", "STATIC_DIR": str(temporary / "public")}, stdout=web_log, stderr=subprocess.STDOUT, start_new_session=True))
    wait_ready(base)
    with sync_playwright() as playwright, httpx.Client(trust_env=False, timeout=10) as client:
        browser = playwright.chromium.launch(executable_path=os.getenv("LEGAL_BROWSER_EXECUTABLE", "/usr/lib64/chromium-browser/headless_shell"), headless=True, args=["--no-sandbox", "--disable-background-networking"])
        contexts = [browser.new_context(accept_downloads=True) for position in range(3)]
        client_page, lawyer_page, operator_page = [context.new_page() for context in contexts]
        for page in (client_page, lawyer_page, operator_page):
            page.on("pageerror", lambda error: page_errors.append(str(error)))
            page.on("response", lambda response: records.append({"path": urlparse(response.url).path, "status": response.status}) if "/api/v1/" in response.url else None)
        login(client_page, "client@example.com", "client-demo-123")
        login(operator_page, "operator@example.com", "operator-demo-123")
        lawyer_page.goto(base)
        lawyer_page.locator('[data-action="register-view"]').click()
        lawyer_page.locator('[name="email"]').fill("browser-lawyer@example.test")
        lawyer_page.locator('[name="name"]').fill("浏览器入驻律师")
        lawyer_page.locator('[name="password"]').fill("browser-lawyer-pass-123")
        lawyer_page.locator('[name="registration_intent"]').select_option("lawyer")
        submit(lawyer_page, "register")
        expect(lawyer_page.locator(".platform-shell")).to_be_visible()
        idle(lawyer_page)
        go(lawyer_page, "profile")
        application = lawyer_page.locator('form[data-form="lawyer-application"]')
        for name, value in {"firm": "浏览器验证律所", "region": "北京", "field": "合同纠纷", "mode": "线上服务", "license_number": "BROWSER-VALIDATION-LICENSE", "expires_on": "2099-01-01"}.items():
            application.locator(f'[name="{name}"]').fill(value)
        png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/woQAAAAASUVORK5CYII=")
        application.locator('[name="credentials"]').set_input_files([{"name": "执业证.png", "mimeType": "image/png", "buffer": png}, {"name": "律所证明.png", "mimeType": "image/png", "buffer": png}])
        submit(lawyer_page, "lawyer-application")
        expect(lawyer_page.locator(".remote-record")).to_contain_text("已提交")
        go(operator_page, "reviewLawyers")
        review = operator_page.locator('form[data-form="review-lawyer"]')
        review.locator('[name="decision"]').select_option("approve")
        review.locator('[name="reason"]').fill("隔离测试：管理员同意律师入驻")
        submit(operator_page, "review-lawyer")
        expect(operator_page.locator(".remote-record")).to_contain_text("已通过")
        passed("浏览器注册、上传证件、自助申请、运营审核与双角色授权")

        go(client_page, "model-chat")
        client_page.locator("#model-prompt").fill("这是一项端到端测试，请帮助整理合同审阅服务的事实与材料清单。")
        client_page.locator(".model-send").click()
        expect(client_page.locator(".model-assistant")).to_be_visible(timeout=30000)
        expect(client_page).to_have_url(re.compile(r"/#/model-chat/[^/?]+$"), timeout=30000)
        consultation_id = client_page.url.split("/model-chat/")[-1]
        client_page.locator('[data-model-feedback="有用"]').click()
        client_page.locator('[data-model-action="request"]').click()
        client_page.locator('form[data-form="consent-summary"] [name="consent"]').check()
        submit(client_page, "consent-summary")
        request_form = client_page.locator('form[data-form="request"]')
        expect(request_form).to_be_visible()
        for name, value in {"title": "浏览器端到端合同审阅", "region": "北京", "budget": "19.90", "deadline": "2099-01-01", "deliverables": "合同审阅报告和修改建议"}.items():
            request_form.locator(f'[name="{name}"]').fill(value)
        request_form.locator('[name="consent"]').check()
        submit(client_page, "request")
        client_page.wait_for_url("**/#/requests/*")
        idle(client_page)
        request_id = client_page.url.split("/requests/")[-1]
        passed("浏览器咨询、评价、显式授权摘要、发布服务需求及数据库保存")

        go(lawyer_page, "requests/" + request_id)
        quote = lawyer_page.locator('form[data-form="quote"]')
        for name, value in {"scope": "合同审阅和风险提示", "deliverables": "审阅报告", "price": "19.90", "days": "3", "valid_until": "2099-01-01"}.items():
            quote.locator(f'[name="{name}"]').fill(value)
        submit(lawyer_page, "quote")
        expect(lawyer_page.locator(".page-body table")).to_contain_text("19.90")
        go(client_page, "requests/" + request_id)
        client_page.locator('[data-action="accept-quote"]').click()
        client_page.wait_for_url("**/#/order/*")
        idle(client_page)
        order_id = client_page.url.split("/order/")[-1]
        client_page.locator('[data-action="pay"]').click()
        expect(client_page.locator(".page-body")).to_contain_text("隔离测试支付单")
        client_headers = token(client, "client@example.com", "client-demo-123")
        lawyer_headers = token(client, "browser-lawyer@example.test", "browser-lawyer-pass-123")
        lawyer_id = client.get(base + "/api/v1/auth/me", headers=lawyer_headers).json()["id"]
        payment = client.get(base + f"/api/v1/orders/{order_id}/payments", headers=client_headers).json()[0]
        payload = {"event_id": "browser-payment-event", "intent_id": payment["intent_id"], "transaction_id": "browser-transaction", "status": "success", "amount": "19.90"}
        raw = json.dumps(payload, separators=(",", ":")).encode()
        timestamp, nonce = str(int(time.time())), uuid4().hex
        signature = hmac.new(process_env["PAYMENT_STUB_SECRET"].encode(), f"{timestamp}\n{nonce}\n".encode() + raw, hashlib.sha256).hexdigest()
        callback_headers = {"Content-Type": "application/json", "X-Payment-Timestamp": timestamp, "X-Payment-Nonce": nonce, "X-Payment-Signature": signature}
        assert client.post(base + "/api/v1/payments/webhooks/stub", content=raw, headers=callback_headers).status_code == 200
        assert client.post(base + "/api/v1/payments/webhooks/stub", content=raw, headers=callback_headers).status_code == 200
        go(client_page, "order/" + order_id)
        expect(client_page.locator(".page-body")).to_contain_text("服务中")
        passed("浏览器报价、接受报价、创建订单、测试支付单及真实HTTP签名回调防重")

        go(lawyer_page, "docs")
        lawyer_page.locator('[data-action="new-document"]').click()
        document_form = lawyer_page.locator('form[data-form="document"]')
        document_form.locator('[name="title"]').fill("浏览器交付审阅报告")
        document_form.locator('[name="body"]').fill("浏览器测试：第一版合同审阅报告")
        submit(lawyer_page, "document")
        lawyer_page.wait_for_url("**/#/doc/*")
        idle(lawyer_page)
        document_id = lawyer_page.url.split("/doc/")[-1]
        lawyer_page.locator('form[data-form="version"] [name="body"]').fill("浏览器测试：第二版合同审阅报告")
        submit(lawyer_page, "version")
        expect(lawyer_page.locator(".page-heading")).to_contain_text("v2")
        lawyer_page.locator('[data-action="workflow-modal"]').click()
        lawyer_page.locator('[name="assignees"]').fill("C1," + lawyer_id)
        submit(lawyer_page, "workflow")
        go(client_page, "doc/" + document_id)
        client_page.locator('[data-action="confirm-document"]').click()
        expect(client_page.locator('.page-body [data-action="confirm-document"]')).to_have_count(0)
        go(lawyer_page, "doc/" + document_id)
        lawyer_page.locator('[data-action="confirm-document"]').click()
        expect(lawyer_page.locator(".document-editor .status").first).to_have_text("已确认")
        go(lawyer_page, "order/" + order_id)
        lawyer_page.locator('[data-action="delivery-modal"]').click()
        lawyer_page.locator('form[data-form="delivery"] [name="document_id"]').select_option(document_id)
        submit(lawyer_page, "delivery")
        go(client_page, "order/" + order_id)
        client_page.locator('[data-action="accept-delivery"]').click()
        expect(client_page.locator(".page-body")).to_contain_text("已完成")
        passed("浏览器文书创建、新版本、双方顺序会签、律师交付和当事人收悉")

        documents = client.get(base + f"/api/v1/documents?order_id={order_id}", headers=client_headers).json()
        contract = next(item for item in documents if item["doc_type"] == "service_contract")
        go(lawyer_page, "doc/" + contract["id"])
        lawyer_page.locator('form[data-form="document-file"] [name="file"]').set_input_files({"name": "browser-evidence.txt", "mimeType": "text/plain", "buffer": b"browser protected material"})
        submit(lawyer_page, "document-file")
        expect(lawyer_page.locator('[data-action="download-file"]')).to_be_visible()
        file_id = lawyer_page.locator('[data-action="download-file"]').get_attribute("data-id")
        go(client_page, "doc/" + contract["id"])
        with client_page.expect_download() as download_info:
            client_page.locator('[data-action="download-file"]').click()
        assert Path(download_info.value.path()).read_bytes() == b"browser protected material"
        with client_page.expect_response(lambda response: response.url.endswith(f"/access/{lawyer_id}/revoke") and response.request.method == "POST") as revoked:
            client_page.locator(f'[data-action="revoke-member"][data-id="{lawyer_id}"]').click()
        assert revoked.value.status == 200
        idle(client_page)
        assert client.get(base + f"/api/v1/files/{file_id}", headers=lawyer_headers).status_code == 403
        assert client.get(base + f"/api/v1/files/{file_id}", headers=client_headers).status_code == 200
        passed("浏览器附件上传、Bearer下载、撤销授权及原上传者再次下载被拒绝")

        go(client_page, "order/" + order_id)
        client_page.locator('[data-action="after-sales-modal"]').click()
        client_page.locator('form[data-form="after-sales"] [name="reason"]').fill("隔离测试：申请全额退款验证")
        submit(client_page, "after-sales")
        go(operator_page, "cases")
        resolve = operator_page.locator('form[data-form="resolve-case"]')
        resolve.locator('[name="decision"]').select_option("approve")
        resolve.locator('[name="resolution"]').fill("隔离测试：同意退款验证")
        submit(operator_page, "resolve-case")
        expect(operator_page.locator('.page-body form[data-form="resolve-case"]')).to_have_count(0)
        go(client_page, "order/" + order_id)
        expect(client_page.locator(".page-body")).to_contain_text("已退款")
        client_page.reload()
        expect(client_page.locator('form[data-form="login"]')).to_be_visible()
        login(client_page, "client@example.com", "client-demo-123")
        go(client_page, "order/" + order_id)
        expect(client_page.locator(".page-body")).to_contain_text("已关闭")
        assert client_page.evaluate("Object.keys(localStorage)") == []
        passed("浏览器退款售后、运营处理、刷新重新登录后数据一致且无localStorage业务事实")
        with psycopg.connect(dsn) as connection:
            assert connection.execute("SELECT status, paid FROM orders WHERE id = %s", (order_id,)).fetchone() == ("closed", Decimal("19.90"))
            assert connection.execute("SELECT COUNT(*) FROM payment_transactions").fetchone()[0] == 1
            assert connection.execute("SELECT COUNT(*) FROM payment_webhook_inbox").fetchone()[0] == 1
            assert connection.execute("SELECT COUNT(*) FROM refunds WHERE status = 'success'").fetchone()[0] == 1
            assert connection.execute("SELECT COUNT(*) FROM consultation_messages WHERE consultation_id = %s", (consultation_id,)).fetchone()[0] == 2
            assert connection.execute("SELECT COUNT(*) FROM user_roles WHERE user_id = %s", (lawyer_id,)).fetchone()[0] == 2
        assert not page_errors, page_errors
        passed("直接PostgreSQL断言：消息、双角色、支付流水、退款、订单及浏览器无运行异常")
        client_page.screenshot(path=str(output / "browser-e2e-success.png"), full_page=True)
        browser.close()
    report.update(status="passed", requests=records, completed_at=datetime.now(timezone.utc).isoformat())
except Exception:
    report.update(status="failed", page_errors=page_errors, requests=records)
    raise
finally:
    for process in reversed(processes):
        try:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=15)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
    sql(f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{database_name}' AND pid <> pg_backend_pid()")
    sql(f"DROP DATABASE {database_name}")
    (output / "browser-e2e.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
