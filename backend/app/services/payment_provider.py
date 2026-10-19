import base64
from datetime import datetime
from decimal import Decimal
import json
import io
from pathlib import Path
import re
import secrets
import time
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
import httpx
import qrcode
from qrcode.image.svg import SvgPathImage

from app.core.config import get_settings
from app.core.errors import DomainError, require
from app.core.payment_security import alipay_canonical, parse_json, public_key, verify_rsa, verify_wechat_signature


def sign(private_key_file, message):
    key = serialization.load_pem_private_key(Path(private_key_file).read_bytes(), password=None)
    require(key.key_size >= 2048, "支付商户密钥无效", 503, "payment_key_invalid")
    return base64.b64encode(key.sign(message, padding.PKCS1v15(), hashes.SHA256())).decode()


class WechatPayProvider:
    name = "wechatpay"

    def __init__(self):
        self.settings = get_settings()
        self.merchant_id = self.settings.wechatpay_mch_id

    def request(self, method, endpoint, payload=None, allow_missing=False):
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) if payload is not None else ""
        timestamp, nonce = str(int(time.time())), secrets.token_hex(16)
        signature = sign(self.settings.wechatpay_private_key_file, f"{method}\n{endpoint}\n{timestamp}\n{nonce}\n{body}\n".encode())
        authorization = f'WECHATPAY2-SHA256-RSA2048 mchid="{self.merchant_id}",nonce_str="{nonce}",timestamp="{timestamp}",serial_no="{self.settings.wechatpay_mch_serial_no}",signature="{signature}"'
        try:
            with httpx.Client(trust_env=False, timeout=self.settings.payment_timeout_seconds) as client:
                response = client.request(method, "https://api.mch.weixin.qq.com" + endpoint, content=body.encode() if body else None, headers={"Authorization": authorization, "Accept": "application/json", "Content-Type": "application/json", "User-Agent": "LegalServiceHub/1.0"})
            if response.content:
                verify_wechat_signature(response.content, response.headers)
            if allow_missing and response.status_code == 404:
                return {"trade_state": "NOTPAY"}
            response.raise_for_status()
            return parse_json(response.content) if response.content else {}
        except DomainError:
            raise
        except Exception as exc:
            raise DomainError("支付渠道请求失败，将使用原商户单号查单补偿", 503, "payment_gateway_unavailable") from exc

    def create_intent(self, payment, title):
        result = self.request("POST", "/v3/pay/transactions/native", {"appid": self.settings.wechatpay_app_id, "mchid": self.merchant_id, "description": title[:100], "out_trade_no": payment.intent_id, "notify_url": self.settings.wechatpay_notify_url, "time_expire": payment.expires_at.replace(tzinfo=ZoneInfo("UTC")).isoformat(), "amount": {"total": int(payment.amount * 100), "currency": "CNY"}})
        code_url = result["code_url"]
        require(isinstance(code_url, str) and code_url.startswith("weixin://") and len(code_url) <= 2048, "支付二维码无效", 502, "invalid_payment_qr")
        image = qrcode.make(code_url, image_factory=SvgPathImage)
        buffer = io.BytesIO()
        image.save(buffer)
        return {"code_url": code_url, "qr_svg_base64": base64.b64encode(buffer.getvalue()).decode()}

    def query(self, payment):
        result = self.request("GET", f"/v3/pay/transactions/out-trade-no/{payment.intent_id}?mchid={self.merchant_id}", allow_missing=True)
        state = result["trade_state"]
        if state == "SUCCESS":
            require(result["mchid"] == self.merchant_id and result["appid"] == self.settings.wechatpay_app_id and result["out_trade_no"] == payment.intent_id, "查单商户不匹配", 409, "payment_merchant_mismatch")
            return {"status": "success", "transaction_id": result["transaction_id"], "amount": str(Decimal(result["amount"]["total"]) / 100), "currency": result["amount"].get("currency", "CNY")}
        return {"status": "closed" if state in {"CLOSED", "REVOKED", "PAYERROR"} else "pending"}

    def close(self, payment):
        self.request("POST", f"/v3/pay/transactions/out-trade-no/{payment.intent_id}/close", {"mchid": self.merchant_id})

    def refund(self, refund, payment):
        result = self.request("POST", "/v3/refund/domestic/refunds", {"out_trade_no": payment.intent_id, "out_refund_no": refund.id, "reason": "法律服务售后退款", "amount": {"refund": int(refund.amount * 100), "total": int(payment.amount * 100), "currency": "CNY"}})
        return result["refund_id"], result["status"] == "SUCCESS"

    def query_refund(self, refund, payment):
        result = self.request("GET", f"/v3/refund/domestic/refunds/{refund.id}")
        require(result["out_trade_no"] == payment.intent_id and result["out_refund_no"] == refund.id and Decimal(result["amount"]["refund"]) == refund.amount * 100, "退款查单数据不匹配", 409, "refund_mismatch")
        return result["refund_id"], result["status"] == "SUCCESS"


class AlipayProvider:
    name = "alipay"

    def __init__(self):
        self.settings = get_settings()
        self.merchant_id = self.settings.alipay_seller_id

    def parameters(self, method, payload):
        return {"app_id": self.settings.alipay_app_id, "method": method, "format": "JSON", "charset": "utf-8", "sign_type": "RSA2", "timestamp": datetime.now(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m-%d %H:%M:%S"), "version": "1.0", "biz_content": json.dumps(payload, ensure_ascii=False, separators=(",", ":"))}

    def signed(self, parameters):
        content = "&".join(f"{name}={value}" for name, value in sorted(parameters.items()) if name != "sign" and value != "")
        parameters["sign"] = sign(self.settings.alipay_private_key_file, content.encode())
        return parameters

    def request(self, method, payload, allow_missing=False):
        parameters = self.signed(self.parameters(method, payload))
        gateway = self.settings.alipay_gateway
        require(gateway in {"https://openapi.alipay.com/gateway.do", "https://openapi-sandbox.dl.alipaydev.com/gateway.do"}, "支付宝网关配置无效", 503, "payment_not_configured")
        require(self.settings.app_env != "production" or gateway == "https://openapi.alipay.com/gateway.do", "生产禁止沙箱收款", 503, "payment_not_configured")
        try:
            with httpx.Client(trust_env=False, timeout=self.settings.payment_timeout_seconds) as client:
                response = client.post(gateway, data=parameters)
            response.raise_for_status()
            raw = response.content.decode("utf-8")
            outer = parse_json(raw)
            response_key = method.replace(".", "_") + "_response"
            match = re.search(r'"' + re.escape(response_key) + r'"\s*:\s*', raw)
            require(match is not None and outer.get("sign"), "支付响应缺少签名", 503, "invalid_payment_signature")
            result, consumed = json.JSONDecoder().raw_decode(raw[match.end():])
            signed_text = raw[match.end():match.end() + consumed]
            verify_rsa(public_key(self.settings.alipay_public_key_file), outer["sign"], signed_text.encode())
            if allow_missing and result.get("sub_code") == "ACQ.TRADE_NOT_EXIST":
                return {"trade_status": "WAIT_BUYER_PAY"}
            require(result.get("code") == "10000", "支付渠道拒绝操作", 503, "payment_gateway_rejected")
            return result
        except DomainError:
            raise
        except Exception as exc:
            raise DomainError("支付渠道请求失败，将使用原商户单号查单补偿", 503, "payment_gateway_unavailable") from exc

    def create_intent(self, payment, title):
        parameters = self.parameters("alipay.trade.page.pay", {"out_trade_no": payment.intent_id, "product_code": "FAST_INSTANT_TRADE_PAY", "total_amount": str(payment.amount), "subject": title[:100], "timeout_express": "30m"})
        parameters["notify_url"] = self.settings.alipay_notify_url
        return {"pay_url": self.settings.alipay_gateway + "?" + urlencode(self.signed(parameters))}

    def query(self, payment):
        result = self.request("alipay.trade.query", {"out_trade_no": payment.intent_id}, allow_missing=True)
        if result["trade_status"] in {"TRADE_SUCCESS", "TRADE_FINISHED"}:
            require(result["out_trade_no"] == payment.intent_id and result.get("seller_user_id", self.merchant_id) == self.merchant_id, "查单商户不匹配", 409, "payment_merchant_mismatch")
            return {"status": "success", "transaction_id": result["trade_no"], "amount": result["total_amount"], "currency": "CNY"}
        return {"status": "closed" if result["trade_status"] == "TRADE_CLOSED" else "pending"}

    def close(self, payment):
        self.request("alipay.trade.close", {"out_trade_no": payment.intent_id}, allow_missing=True)

    def refund(self, refund, payment):
        result = self.request("alipay.trade.refund", {"out_trade_no": payment.intent_id, "out_request_no": refund.id, "refund_amount": str(refund.amount)})
        require(Decimal(result["refund_fee"]) == refund.amount, "退款金额不匹配", 409, "refund_mismatch")
        return result["trade_no"], result.get("fund_change") == "Y"

    def query_refund(self, refund, payment):
        result = self.request("alipay.trade.fastpay.refund.query", {"out_trade_no": payment.intent_id, "out_request_no": refund.id})
        require(result["out_trade_no"] == payment.intent_id and Decimal(result["refund_amount"]) == refund.amount, "退款查单数据不匹配", 409, "refund_mismatch")
        return result["trade_no"], result.get("refund_status") == "REFUND_SUCCESS"


class StubPaymentProvider:
    name = "stub"
    merchant_id = "test"

    def create_intent(self, payment, title):
        qr_payload = "\n".join(
            (
                "法律服务平台模拟支付",
                f"订单：{payment.intent_id}",
                f"金额：{payment.amount:.2f}元",
                "仅用于内网演示，不产生真实资金",
            )
        )
        image = qrcode.make(qr_payload, image_factory=SvgPathImage)
        buffer = io.BytesIO()
        image.save(buffer)
        return {
            "test_only": True,
            "mode": "simulation",
            "title": title[:100],
            "amount": str(payment.amount),
            "currency": "CNY",
            "qr_svg_base64": base64.b64encode(buffer.getvalue()).decode(),
        }

    def query(self, payment):
        return {"status": "pending"}

    def close(self, payment):
        return None

    def refund(self, refund, payment):
        return "test-" + refund.id, True

    def query_refund(self, refund, payment):
        return self.refund(refund, payment)


def get_payment_provider(provider=None):
    settings = get_settings()
    selected = provider or settings.payment_provider
    require(selected == settings.payment_provider and selected != "disabled", "收款渠道尚未完成配置与验收，暂不可支付", 503, "payment_disabled")
    if selected == "stub":
        require(settings.app_env != "production" and settings.payment_stub_enabled and len(settings.payment_stub_secret) >= 32, "测试支付已关闭", 503, "payment_disabled")
        return StubPaymentProvider()
    return WechatPayProvider() if selected == "wechatpay" else AlipayProvider()
