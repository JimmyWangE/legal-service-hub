import csv
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import io
from zoneinfo import ZoneInfo

from sqlalchemy import text

from app.core.errors import require
from app.models import AuditLog, Payment, PaymentTransaction, Refund
from app.services.common import commit_event, new_id, record_audit


columns = ["provider", "merchant_id", "business_date", "kind", "intent_id", "transaction_id", "refund_id", "amount", "currency"]


def reconcile_statement(db, raw, business_date, provider, merchant_id, evidence):
    require(provider in {"wechatpay", "alipay", "stub"} and merchant_id, "账单渠道或商户无效", 422)
    require(len(evidence.strip()) >= 8 and len(raw) <= 20 * 1024 * 1024, "需要可信账单来源说明，账单不得超过20MiB", 422)
    day = date.fromisoformat(business_date)
    digest = hashlib.sha256(raw).hexdigest()
    scope = hashlib.sha256(f"{provider}:{merchant_id}:{business_date}:{digest}".encode()).hexdigest()[:36]
    if db.bind.dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(:identity)"), {"identity": int(scope[:15], 16)})
    existing = db.query(AuditLog).filter_by(action="payment.reconciled", object_id=scope).first()
    if existing:
        return existing.detail_json
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
    require(reader.fieldnames == columns, "账单必须使用规范CSV列，不允许直接猜测解析官方原始文件", 422)
    differences, seen_payments, seen_refunds = [], set(), set()
    count = 0
    for entry in reader:
        count += 1
        require(count <= 100000 and entry["provider"] == provider and entry["merchant_id"] == merchant_id and entry["business_date"] == business_date and entry["currency"] == "CNY", "账单行范围或币种错误", 422)
        try:
            amount = Decimal(entry["amount"])
            require(amount.is_finite() and amount > 0 and amount == amount.quantize(Decimal("0.01")), "账单金额无效", 422)
        except InvalidOperation:
            require(False, "账单金额无效", 422)
        payment = db.query(Payment).filter_by(provider=provider, merchant_id=merchant_id, intent_id=entry["intent_id"]).first()
        key = entry["transaction_id"] if entry["kind"] == "payment" else entry["refund_id"]
        seen = seen_payments if entry["kind"] == "payment" else seen_refunds
        require(entry["kind"] in {"payment", "refund"} and key and key not in seen, "账单类型无效或流水重复", 422)
        seen.add(key)
        if entry["kind"] == "payment":
            ledger = db.query(PaymentTransaction).filter_by(provider=provider, merchant_id=merchant_id, transaction_id=key).first()
            match = ledger and payment and ledger.payment_id == payment.id and ledger.amount == amount
        else:
            refund = db.query(Refund).filter_by(provider_refund_id=key, status="success").first()
            match = refund and payment and refund.payment_id == payment.id and refund.amount == amount
        if not match:
            differences.append({"kind": entry["kind"], "reference": key, "issue": "missing_or_mismatched_local_entry"})
    start = datetime.combine(day, time.min, ZoneInfo("Asia/Shanghai")).astimezone(timezone.utc)
    end = start + timedelta(days=1)
    for ledger in db.query(PaymentTransaction).filter_by(provider=provider, merchant_id=merchant_id).filter(PaymentTransaction.created_at >= start, PaymentTransaction.created_at < end):
        if ledger.transaction_id not in seen_payments:
            differences.append({"kind": "payment", "reference": ledger.transaction_id, "issue": "missing_from_statement_review_settlement_date"})
    for refund in db.query(Refund).join(Payment).filter(Payment.provider == provider, Payment.merchant_id == merchant_id, Refund.status == "success", Refund.created_at >= start, Refund.created_at < end):
        if refund.provider_refund_id not in seen_refunds:
            differences.append({"kind": "refund", "reference": refund.provider_refund_id, "issue": "missing_from_statement_review_settlement_date"})
    require(len(differences) <= 10000, "差异过多，需要拆分受控账单再导入", 422)
    report = {"id": scope, "date": business_date, "provider": provider, "merchant_id": merchant_id, "sha256": digest, "source_evidence": evidence, "rows": count, "differences": differences, "status": "manual_review" if differences else "matched", "money_writes": False}
    record_audit(db, None, "payment.reconciled", "statement", scope, report)
    commit_event(db, "payment.reconciliation_completed", "statement", scope, {"status": report["status"], "difference_count": len(differences)})
    db.flush()
    return report
