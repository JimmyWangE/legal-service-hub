from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sys
from uuid import uuid4

import httpx
from playwright.sync_api import expect, sync_playwright


root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / "backend"))
values = dict(line.split("=", 1) for line in Path("/etc/legal-service-hub/api.env").read_text().splitlines() if line and not line.startswith("#"))
os.environ.update(values)

from app.core.database import SessionLocal
from app.models import Consultation, ConsultationMessage, User
from app.services.common import record_audit


base = "http://127.0.0.1:189"
email = "live-check-" + uuid4().hex + "@example.invalid"
password = secrets.token_urlsafe(32)
output = root / "test-results"
output.mkdir(exist_ok=True)
report = {"started_at": datetime.now(timezone.utc).isoformat(), "environment": "actual_systemd_legal_api_real_model", "model": values["MODEL_NAME"], "status": "failed"}
user_id = None
try:
    with httpx.Client(trust_env=False, timeout=15) as client:
        challenge = client.get(base + "/api/v1/auth/registration-challenge")
        challenge.raise_for_status()
        match = re.fullmatch(r"(\d+) \+ (\d+) = \?", challenge.json()["question"])
        if not match:
            raise RuntimeError("注册安全问答格式异常")
        registration = {"email": email, "name": "受控真实模型验收", "password": password, "challenge_id": challenge.json()["id"], "challenge_answer": str(int(match.group(1)) + int(match.group(2)))}
        registered = client.post(base + "/api/v1/auth/register", json=registration)
        registered.raise_for_status()
        user_id = registered.json()["user"]["id"]
        report["user_id"] = user_id
        assert client.post(base + "/api/v1/payments/webhooks/stub", json={}).status_code == 503
        for target in ("/backend/.env", "/backend/data/legal_service.db", "/business.js", "/.git/config"):
            assert client.get(base + target).status_code in {403, 404}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path="/usr/lib64/chromium-browser/headless_shell", headless=True, args=["--no-sandbox", "--disable-background-networking", "--no-proxy-server"])
        page = browser.new_page(accept_downloads=False)
        page.goto(base)
        page.locator('[name="email"]').fill(email)
        page.locator('[name="password"]').fill(password)
        page.locator('form[data-form="login"] button[type="submit"]').click()
        expect(page.locator(".platform-shell")).to_be_visible()
        page.goto(base + "/#/model-chat")
        page.locator("#model-prompt").fill("这是一项真实模型链路验收，请用一句话说明签订服务合同前需要核对哪些信息。请不要输出思考过程。")
        with page.expect_response(lambda response: response.request.method == "POST" and response.url.endswith("/messages"), timeout=115000) as received:
            page.locator(".model-send").click()
        response = received.value
        report.update(response_status=response.status, request_id=response.headers.get("x-request-id"))
        assert response.status == 200, "真实模型业务响应失败，请检查脱敏响应和服务日志"
        expect(page.locator(".model-assistant")).to_be_visible(timeout=10000)
        consultation_id = page.url.split("/model-chat/")[-1]
        with SessionLocal() as db:
            consultation = db.get(Consultation, consultation_id)
            assert consultation.owner_id == user_id
            messages = db.query(ConsultationMessage).filter_by(consultation_id=consultation_id).order_by(ConsultationMessage.sequence).all()
            assert len(messages) == 2 and messages[1].source == "model"
            assert messages[1].text.strip() and "本地示例回复" not in messages[1].text
            report.update(consultation_id=consultation_id, persisted_messages=2, answer_length=len(messages[1].text), answer_sha256=hashlib.sha256(messages[1].text.encode()).hexdigest())
        assert page.evaluate("Object.keys(localStorage)") == []
        page.screenshot(path=str(output / "real-model-browser.png"), full_page=True)
        browser.close()
    report.update(status="passed", completed_at=datetime.now(timezone.utc).isoformat())
    print("真实浏览器 → :189同源代理 → systemd legal-api → 已认证真实模型 → PostgreSQL落库验证通过")
finally:
    if user_id:
        with SessionLocal.begin() as db:
            user = db.get(User, user_id)
            user.is_active = False
            user.token_version += 1
            record_audit(db, None, "verification.account_deactivated", "user", user_id, {"reason": "真实模型受控验收结束"})
    (output / "real-model-e2e.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
