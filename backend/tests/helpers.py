import hashlib
import hmac
import json
import re
import time
from uuid import uuid4

from app.core.config import get_settings


def registration_payload(client, email, name, password, registration_intent="client"):
    challenge = client.get("/api/v1/auth/registration-challenge")
    assert challenge.status_code == 200, challenge.text
    match = re.fullmatch(r"(\d+) \+ (\d+) = \?", challenge.json()["question"])
    assert match
    answer = int(match.group(1)) + int(match.group(2))
    return {"email": email, "name": name, "password": password, "registration_intent": registration_intent, "challenge_id": challenge.json()["id"], "challenge_answer": str(answer)}


def post_webhook(client, payload, provider="stub", **overrides):
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    timestamp, nonce = str(int(time.time())), uuid4().hex
    signature = hmac.new(get_settings().payment_stub_secret.encode(), f"{timestamp}\n{nonce}\n".encode() + raw, hashlib.sha256).hexdigest()
    headers = {"Content-Type": "application/json", "X-Payment-Timestamp": timestamp, "X-Payment-Nonce": nonce, "X-Payment-Signature": signature, **overrides}
    return client.post(f"/api/v1/payments/webhooks/{provider}", content=raw, headers=headers)
