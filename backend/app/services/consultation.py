from datetime import datetime, timezone
import json
import re

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.core.errors import DomainError, require
from app.core.config import get_settings
from app.core.database import SessionLocal
from app.models import Consultation, ConsultationFeedback, ConsultationMessage, Consent, User
from app.schemas import MessageCreate, SummaryCreate
from app.services.common import commit_event, new_id, record_audit, stable_hash
from app.services.model_provider import ModelAnswer, get_model_provider


REQUEST_DRAFT_FIELDS = ("title", "domain", "field", "service_type", "region", "budget", "deadline", "facts", "deliverables")


def _conversation_transcript(messages: list[ConsultationMessage]) -> str:
    parts = []
    for message in messages:
        role = "用户" if message.role == "user" else "法律助手"
        parts.append(f"{role}：{message.text[:6000]}")
    return "\n\n".join(parts)[-30000:]


def _fallback_request_draft(consultation: Consultation, user_messages: list[ConsultationMessage]) -> dict:
    questions = [message.text for message in user_messages]
    facts = "\n\n".join(questions)[:12000]
    topic = (consultation.topic or "综合咨询").strip()[:100]
    domain = "民商事" if topic in {"综合咨询", "合同问题", "公司商事", "婚姻家事"} else ""
    region = ""
    budget = ""
    deadline = ""
    return {
        "title": f"{topic}法律服务需求",
        "domain": domain,
        "field": topic,
        "service_type": "法律咨询与材料审阅",
        "region": region,
        "budget": budget,
        "deadline": deadline,
        "facts": facts,
        "deliverables": "法律分析意见、风险提示及下一步建议",
        "missing_fields": [name for name, value in (("domain", domain), ("region", region), ("budget", budget), ("deadline", deadline)) if not value],
        "confidence": {},
        "generated_by": "fallback",
    }


def _json_object(text: str) -> dict | None:
    cleaned = str(text or "").strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned, flags=re.IGNORECASE | re.DOTALL).strip()
    try:
        value = json.loads(cleaned)
        return value if isinstance(value, dict) else None
    except (TypeError, ValueError, json.JSONDecodeError):
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start < 0 or end <= start:
            return None
        try:
            value = json.loads(cleaned[start:end + 1])
            return value if isinstance(value, dict) else None
        except (TypeError, ValueError, json.JSONDecodeError):
            return None


def _normalized_request_draft(raw: dict, fallback: dict) -> dict:
    def text_value(name: str, limit: int) -> str:
        value = raw.get(name)
        return str(value).strip()[:limit] if value is not None else ""

    draft = {name: text_value(name, 12000 if name == "facts" else 5000) for name in REQUEST_DRAFT_FIELDS}
    if len(draft["title"]) < 2:
        draft["title"] = fallback["title"]
    if not draft["facts"] or len(draft["facts"]) < 8:
        draft["facts"] = fallback["facts"]
    if not draft["deliverables"]:
        draft["deliverables"] = fallback["deliverables"]

    budget_match = re.search(r"(?<!\d)(\d+(?:\.\d{1,2})?)(?!\d)", draft["budget"])
    draft["budget"] = budget_match.group(1) if budget_match else ""
    date_match = re.search(r"(20\d{2})[-年](\d{1,2})[-月](\d{1,2})日?", draft["deadline"])
    draft["deadline"] = f"{int(date_match.group(1)):04d}-{int(date_match.group(2)):02d}-{int(date_match.group(3)):02d}" if date_match else ""
    draft["missing_fields"] = [name for name in REQUEST_DRAFT_FIELDS if not draft[name]]
    confidence = raw.get("confidence")
    draft["confidence"] = confidence if isinstance(confidence, dict) else {}
    draft["generated_by"] = "model"
    return draft


def _generate_request_draft(consultation: Consultation, messages: list[ConsultationMessage], user_messages: list[ConsultationMessage]) -> dict:
    fallback = _fallback_request_draft(consultation, user_messages)
    prompt = (
        "请根据下面的法律咨询对话生成一个可编辑的服务需求草稿。只输出一个合法 JSON 对象，不要 Markdown、不要解释。"
        "不明确或对话中没有出现的信息必须使用空字符串，不得猜测预算、地区或截止日期。"
        "事实与目标应概括用户已说明的事实、诉求和希望结果；交付物要求应根据明确诉求归纳，无法确定时填写合理的待确认描述。"
        "JSON 字段必须严格包含：title、domain、field、service_type、region、budget、deadline、facts、deliverables、confidence。"
        "budget 只填写数字字符串或空字符串；deadline 只填写 YYYY-MM-DD 或空字符串；confidence 是字段到 0-1 数字的对象。\n\n"
        f"咨询领域：{consultation.topic}\n对话记录：\n{_conversation_transcript(messages)}"
    )
    try:
        answer = get_model_provider().answer(prompt, "服务需求字段提取")
        parsed = _json_object(answer.text)
        return _normalized_request_draft(parsed, fallback) if parsed else fallback
    except (DomainError, TypeError, ValueError, KeyError):
        return fallback


def create(db: Session, owner_id: str, topic: str, title: str | None) -> Consultation:
    consultation = Consultation(
        id=new_id(), owner_id=owner_id, topic=topic, title=title or "新的法律咨询"
    )
    db.add(consultation)
    db.flush()
    db.refresh(consultation)
    return consultation


def get_owned(db: Session, consultation_id: str, owner_id: str) -> Consultation:
    consultation = db.get(Consultation, consultation_id)
    if not consultation or consultation.owner_id != owner_id:
        raise DomainError("咨询不存在或无权访问", 404, "not_found")
    return consultation


def prepare_message(db: Session, consultation: Consultation, actor: User, payload: MessageCreate):
    require(consultation.owner_id == actor.id and actor.has_role("client"), "无权访问此咨询", 403, "forbidden")
    require(not payload.attachments or all(isinstance(item, dict) and item.get("file_id") for item in payload.attachments), "材料必须先上传获取file_id；当前材料仅保存，不参与模型回答", 422, "invalid_attachment")
    from app.models import StoredFile

    attachments = []
    for item in payload.attachments:
        stored = db.get(StoredFile, item["file_id"])
        require(stored is not None and stored.owner_id == actor.id and stored.document_id is None and stored.status == "available", "无权关联此材料", 403, "forbidden")
        attachments.append({"file_id": stored.id, "name": stored.original_name, "size": stored.size})
    context = []
    if payload.context_enabled:
        history = db.query(ConsultationMessage).filter_by(consultation_id=consultation.id).order_by(ConsultationMessage.sequence.desc()).limit(12).all()
        context = [{"role": item.role, "content": item.text} for item in reversed(history)]
    return attachments, context, consultation.version


def persist_message(db: Session, consultation: Consultation, actor: User, payload: MessageCreate, attachments: list[dict], expected_version: int, answer: ModelAnswer, request_id: str = ""):
    require(consultation.owner_id == actor.id and actor.has_role("client"), "无权访问此咨询", 403, "forbidden")
    now = datetime.now(timezone.utc)
    changed = db.execute(update(Consultation).where(Consultation.id == consultation.id, Consultation.version == expected_version).values(version=expected_version + 2).execution_options(synchronize_session=False)).rowcount
    require(changed == 1, "咨询已收到新的追问，请刷新后重试", 409, "consultation_conflict")
    consultation.version = expected_version + 2
    user_message = ConsultationMessage(
        id=new_id(),
        consultation_id=consultation.id,
        role="user",
        text=payload.prompt,
        attachments_json=attachments,
        sequence=expected_version + 1,
        source="user",
        created_at=now,
    )
    assistant_message = ConsultationMessage(
        id=new_id(),
        consultation_id=consultation.id,
        role="assistant",
        text=answer.text,
        risk=answer.risk,
        sequence=expected_version + 2,
        source="demo" if get_settings().model_provider == "stub" else "model",
        created_at=now,
    )
    db.add_all([user_message, assistant_message])
    consultation.topic = payload.topic
    consultation.title = payload.prompt[:80]
    consultation.risk_level = "high" if answer.risk else "normal"
    consultation.updated_at = now
    record_audit(db, actor, "consultation.message", "consultation", consultation.id, request_id=request_id)
    commit_event(db, "consultation.message.created", "consultation", consultation.id, {"risk": answer.risk})
    db.flush()
    return user_message, assistant_message


def add_message(db: Session, consultation: Consultation, actor: User, payload: MessageCreate, request_id: str = ""):
    attachments, context, expected_version = prepare_message(db, consultation, actor, payload)
    answer = get_model_provider().answer(payload.prompt, payload.topic, context)
    return persist_message(db, consultation, actor, payload, attachments, expected_version, answer, request_id)


def stream_message(consultation_id: str, user_id: str, payload: MessageCreate, request_id: str, prepared: tuple[list[dict], list[dict], int], idempotency_id: str | None = None):
    from app.api.serializers import consultation_out
    from app.core.idempotency import encode
    from app.models import IdempotencyRecord

    def event(name: str, data: dict):
        import json

        return f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"

    attachments, context, expected_version = prepared
    answer_text = []
    completed = False
    try:
        yield event("start", {"consultation_id": consultation_id})
        provider = get_model_provider()
        for chunk in provider.stream_answer(payload.prompt, payload.topic, context):
            answer_text.append(chunk)
            yield event("chunk", {"text": chunk})
        text = "".join(answer_text).strip()
        require(text, "模型没有返回可展示内容", 503, "model_unavailable")
        risk_terms = ("羁押", "逮捕", "刑拘", "立案", "时效", "财产转移", "人身危险")
        answer = ModelAnswer(text=text, risk=any(term in payload.prompt or term in text for term in risk_terms))
        with SessionLocal.begin() as db:
            actor = db.get(User, user_id)
            require(actor is not None and actor.is_active, "登录状态已失效", 401, "unauthorized")
            consultation = get_owned(db, consultation_id, user_id)
            persist_message(db, consultation, actor, payload, attachments, expected_version, answer, request_id)
            result = encode(consultation_out(db, consultation))
            if idempotency_id:
                record = db.get(IdempotencyRecord, idempotency_id)
                if record:
                    record.status_code = 200
                    record.response_json = result
            db.flush()
        completed = True
        yield event("done", result)
    except DomainError as exc:
        yield event("error", {"code": exc.code, "message": exc.message})
    except Exception:
        yield event("error", {"code": "model_unavailable", "message": "模型服务暂时不可用，请稍后重试或联系人工律师"})
    finally:
        if not completed and idempotency_id:
            try:
                with SessionLocal.begin() as db:
                    record = db.get(IdempotencyRecord, idempotency_id)
                    if record and record.status_code == 0:
                        db.delete(record)
            except Exception:
                pass


def add_feedback(db: Session, consultation: Consultation, user_id: str, message_id: str, value: str, reason: str):
    require(consultation.owner_id == user_id, "无权访问此咨询", 403, "forbidden")
    message = db.get(ConsultationMessage, message_id)
    require(message is not None and message.consultation_id == consultation.id and message.role == "assistant", "反馈对象无效", 422, "invalid_feedback")
    feedback = db.query(ConsultationFeedback).filter_by(user_id=user_id, message_id=message_id).first()
    if feedback:
        feedback.value = value
        feedback.reason = reason
    else:
        feedback = ConsultationFeedback(id=new_id(), consultation_id=consultation.id, message_id=message_id, user_id=user_id, value=value, reason=reason)
        db.add(feedback)
    db.flush()
    return feedback


def create_summary(db: Session, consultation: Consultation, user_id: str, payload: SummaryCreate):
    require(consultation.owner_id == user_id, "无权访问此咨询", 403, "forbidden")
    require(payload.consent, "生成需求摘要前必须明确授权", 422, "consent_required")
    messages = db.query(ConsultationMessage).filter_by(consultation_id=consultation.id).order_by(ConsultationMessage.sequence).limit(200).all()
    user_messages = [message for message in messages if message.role == "user"]
    require(user_messages, "咨询还没有用户提问", 422, "empty_consultation")
    snapshot = {
        "source_id": consultation.id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "questions": [message.text for message in user_messages],
        "attachments": [item for message in user_messages for item in message.attachments_json],
        "request_draft": _generate_request_draft(consultation, messages, user_messages),
    }
    digest = stable_hash(snapshot)
    consent = db.query(Consent).filter_by(owner_id=user_id, source_id=consultation.id, scope=payload.scope, snapshot_hash=digest).first()
    if not consent:
        consent = Consent(id=new_id(), owner_id=user_id, source_id=consultation.id, scope=payload.scope, snapshot_hash=digest, snapshot_json=snapshot)
        db.add(consent)
    consultation.summary_json = snapshot
    db.flush()
    return snapshot, consent
