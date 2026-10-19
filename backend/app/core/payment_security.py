import base64
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import hmac
import json
from pathlib import Path
import time
from urllib.parse import parse_qsl
from zoneinfo import ZoneInfo

from cryptography import x509
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import get_settings
from app.core.errors import DomainError, require


def public_key(path):
    raw = Path(path).read_bytes()
    if b"BEGIN CERTIFICATE" in raw:
        certificate = x509.load_pem_x509_certificate(raw)
        now = datetime.now(timezone.utc)
        require(certificate.not_valid_before_utc <= now < certificate.not_valid_after_utc, "支付验证证书已过期", 503, "payment_key_expired")
        key = certificate.public_key()
    else:
        key = serialization.load_pem_public_key(raw)
    require(isinstance(key, rsa.RSAPublicKey) and key.key_size >= 2048, "支付验证密钥无效", 503, "payment_key_invalid")
    return key


def trusted_wechat_keys():
    directory = Path(get_settings().wechatpay_verify_keys_dir)
    require(directory.is_dir(), "支付验证密钥未配置", 503, "payment_not_configured")
    return {path.stem: public_key(path) for path in directory.glob("*.pem")}


def verify_rsa(key, signature, message):
    try:
        key.verify(base64.b64decode(signature, validate=True), message, padding.PKCS1v15(), hashes.SHA256())
    except (InvalidSignature, ValueError, TypeError) as exc:
        raise DomainError("支付通知认证失败", 401, "invalid_payment_signature") from exc


def verify_wechat_signature(raw_body, headers, keys=None, now=None):
    headers = {name.lower(): value for name, value in headers.items()}
    try:
        timestamp = headers["wechatpay-timestamp"]
        nonce = headers["wechatpay-nonce"]
        serial = headers["wechatpay-serial"]
        require(abs((time.time() if now is None else now) - int(timestamp)) <= get_settings().payment_timestamp_tolerance_seconds, "支付通知时间戳无效", 401, "payment_timestamp_invalid")
        require(nonce and len(nonce) <= 128 and "\n" not in nonce, "通知Nonce无效", 401, "invalid_payment_signature")
        mapping = trusted_wechat_keys() if keys is None else keys
        require(serial in mapping, "支付验证密钥未知", 401, "unknown_payment_key")
        message = f"{timestamp}\n{nonce}\n".encode("ascii") + raw_body + b"\n"
        verify_rsa(mapping[serial], headers["wechatpay-signature"], message)
    except (KeyError, ValueError, UnicodeError) as exc:
        raise DomainError("支付通知认证失败", 401, "invalid_payment_signature") from exc


def parse_json(raw):
    def unique_pairs(pairs):
        result = {}
        for name, value in pairs:
            if name in result:
                raise ValueError("duplicate JSON member")
            result[name] = value
        return result

    try:
        result = json.loads(raw, object_pairs_hook=unique_pairs)
        require(isinstance(result, dict), "通知格式无效", 422, "invalid_payment_event")
        return result
    except (ValueError, UnicodeError) as exc:
        raise DomainError("通知格式无效", 422, "invalid_payment_event") from exc


def parse_wechat_event(raw, headers):
    settings = get_settings()
    verify_wechat_signature(raw, headers)
    payload = parse_json(raw)
    try:
        require(payload["event_type"] == "TRANSACTION.SUCCESS", "不支持的通知类型", 422, "invalid_payment_event")
        resource = payload["resource"]
        require(resource["algorithm"] == "AEAD_AES_256_GCM", "不支持的加密算法", 422, "invalid_payment_event")
        secret = Path(settings.wechatpay_api_v3_key_file).read_bytes().strip()
        require(len(secret) == 32, "支付解密密钥无效", 503, "payment_key_invalid")
        data = AESGCM(secret).decrypt(resource["nonce"].encode(), base64.b64decode(resource["ciphertext"], validate=True), resource.get("associated_data", "").encode())
        data = parse_json(data)
        require(data["mchid"] == settings.wechatpay_mch_id and data["appid"] == settings.wechatpay_app_id, "收款商户不匹配", 401, "payment_merchant_mismatch")
        require(data["trade_state"] == "SUCCESS", "支付状态无效", 422, "invalid_payment_event")
        cents = data["amount"]["total"]
        require(isinstance(cents, int) and not isinstance(cents, bool) and cents > 0, "金额无效", 422, "invalid_amount")
        return {"provider": "wechatpay", "merchant_id": data["mchid"], "event_id": payload["id"], "intent_id": data["out_trade_no"], "transaction_id": data["transaction_id"], "status": "success", "currency": data["amount"].get("currency", "CNY"), "amount": str(Decimal(cents) / 100)}
    except DomainError:
        raise
    except Exception as exc:
        raise DomainError("支付通知解密或字段校验失败", 422, "invalid_payment_event") from exc


def alipay_canonical(parameters):
    return "&".join(f"{name}={value}" for name, value in sorted(parameters.items()) if name not in {"sign", "sign_type"} and value != "")


def parse_alipay_event(raw):
    settings = get_settings()
    try:
        pairs = parse_qsl(raw.decode("utf-8"), keep_blank_values=True, strict_parsing=True, max_num_fields=100)
        parameters = dict(pairs)
        require(len(parameters) == len(pairs), "通知存在重复字段", 422, "invalid_payment_event")
        require(parameters.get("sign_type") == "RSA2", "仅支持RSA2签名", 401, "invalid_payment_signature")
        verify_rsa(public_key(settings.alipay_public_key_file), parameters["sign"], alipay_canonical(parameters).encode())
        require(parameters["app_id"] == settings.alipay_app_id and parameters["seller_id"] == settings.alipay_seller_id, "收款商户不匹配", 401, "payment_merchant_mismatch")
        notified = datetime.strptime(parameters["notify_time"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=ZoneInfo("Asia/Shanghai"))
        age = time.time() - notified.timestamp()
        require(age >= -settings.payment_timestamp_tolerance_seconds, "支付通知时间戳无效", 401, "payment_timestamp_invalid")
        amount = Decimal(parameters["total_amount"])
        require(amount.is_finite() and amount > 0 and amount == amount.quantize(Decimal("0.01")), "支付金额无效", 422, "invalid_amount")
        states = {"TRADE_SUCCESS": "success", "TRADE_FINISHED": "success", "TRADE_CLOSED": "closed", "WAIT_BUYER_PAY": "pending"}
        return {"provider": "alipay", "merchant_id": parameters["seller_id"], "event_id": parameters["notify_id"], "intent_id": parameters["out_trade_no"], "transaction_id": parameters["trade_no"], "status": states[parameters["trade_status"]], "currency": "CNY", "amount": str(amount), "requires_query": age > settings.alipay_notify_max_age_hours * 3600}
    except DomainError:
        raise
    except (KeyError, ValueError, InvalidOperation) as exc:
        raise DomainError("支付通知格式无效", 422, "invalid_payment_event") from exc


def parse_stub_event(raw, headers):
    settings = get_settings()
    require(settings.app_env != "production" and settings.payment_stub_enabled and len(settings.payment_stub_secret) >= 32, "测试支付已关闭", 404, "payment_disabled")
    try:
        timestamp = headers.get("x-payment-timestamp", "")
        nonce = headers.get("x-payment-nonce", "")
        require(abs(time.time() - int(timestamp)) <= settings.payment_timestamp_tolerance_seconds and 0 < len(nonce) <= 128, "通知时间戳无效", 401, "payment_timestamp_invalid")
        expected = hmac.new(settings.payment_stub_secret.encode(), f"{timestamp}\n{nonce}\n".encode() + raw, hashlib.sha256).hexdigest()
        require(hmac.compare_digest(expected, headers.get("x-payment-signature", "")), "支付通知认证失败", 401, "invalid_payment_signature")
        payload = parse_json(raw)
        return {"provider": "stub", "merchant_id": "test", "event_id": payload["event_id"], "intent_id": payload["intent_id"], "transaction_id": payload.get("transaction_id", payload["intent_id"]), "status": payload["status"], "amount": str(payload["amount"]), "currency": "CNY"}
    except (ValueError, KeyError) as exc:
        raise DomainError("支付通知认证失败", 401, "invalid_payment_signature") from exc
