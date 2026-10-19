from datetime import date, datetime, timedelta, timezone
import hashlib
import hmac
from pathlib import Path
import re
import secrets

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import DomainError, require
from app.core.security import hash_password, verify_password
from app.models import LawyerApplication, LawyerProfile, LawyerReviewRecord, RegistrationChallenge, StoredFile, User, UserRole
from app.schemas import LawyerApply, LawyerReview, RegisterRequest
from app.services.common import commit_event, new_id, notify, record_audit


def login(db: Session, email: str, password: str) -> User:
    user = db.query(User).filter(User.email == email.lower().strip()).first()
    if not user or not user.is_active or not verify_password(password, user.password_hash):
        raise DomainError("邮箱或密码错误", 401, "invalid_credentials")
    return user


def _challenge_digest(challenge_id: str, answer: str) -> str:
    settings = get_settings()
    return hmac.new(settings.jwt_secret.encode(), f"registration:{challenge_id}:{answer}".encode(), hashlib.sha256).hexdigest()


def create_registration_challenge(db: Session) -> RegistrationChallenge:
    left = secrets.randbelow(20) + 1
    right = secrets.randbelow(20) + 1
    challenge_id = new_id()
    challenge = RegistrationChallenge(
        id=challenge_id,
        question=f"{left} + {right} = ?",
        answer_hash=_challenge_digest(challenge_id, str(left + right)),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
    )
    db.add(challenge)
    db.flush()
    return challenge


def verify_registration_challenge(db: Session, challenge_id: str, answer: str) -> None:
    normalized = answer.strip()
    require(bool(re.fullmatch(r"\d{1,3}", normalized)), "安全问答答案格式不正确", 422, "invalid_registration_challenge")
    challenge = db.query(RegistrationChallenge).filter_by(id=challenge_id).with_for_update().first()
    now = datetime.now(timezone.utc)
    require(challenge is not None and challenge.used_at is None and challenge.expires_at.replace(tzinfo=timezone.utc) > now, "安全问答已失效，请刷新题目", 422, "invalid_registration_challenge")
    require(hmac.compare_digest(challenge.answer_hash, _challenge_digest(challenge.id, normalized)), "安全问答答案错误", 422, "invalid_registration_challenge")
    challenge.used_at = now


def register(db: Session, payload: RegisterRequest) -> User:
    verify_registration_challenge(db, payload.challenge_id, payload.challenge_answer)
    email = payload.email.lower().strip()
    require(not db.query(User).filter_by(email=email).first(), "邮箱已注册", 409, "duplicate_email")
    user = User(id=new_id(), email=email, name=payload.name, role="client", password_hash=hash_password(payload.password), email_verified=True, role_grants=[UserRole(role="client", source="registration")])
    db.add(user)
    db.flush()
    record_audit(db, user, "account.registered", "user", user.id)
    return user


def apply_lawyer(db: Session, user: User, payload: LawyerApply, request_id: str = "") -> LawyerApplication:
    user = db.query(User).filter_by(id=user.id).with_for_update().one()
    require(not user.has_role("operator"), "运营账户不能申请律师身份", 403, "forbidden")
    require(payload.expires_on >= date.today(), "执业证已过期", 422, "invalid_license")
    require(not db.query(LawyerApplication).filter(LawyerApplication.user_id == user.id, LawyerApplication.status.in_(["submitted", "under_review", "draft"])).first(), "已有待审核申请", 409, "application_pending")
    require(bool(payload.credential_file_ids) or get_settings().app_env == "test", "请上传执业证及律所证明", 422, "credentials_required")
    for file_id in payload.credential_file_ids:
        stored = db.get(StoredFile, file_id)
        require(stored is not None and stored.owner_id == user.id and stored.document_id is None and stored.status == "available", "证件材料不属于本人", 403, "invalid_credentials_file")
        with Path(stored.storage_path).open("rb") as stream:
            header = stream.read(16)
        require(header.startswith((b"%PDF-", b"\x89PNG\r\n\x1a\n", b"\xff\xd8\xff")), "证件仅支持有效PDF或图片", 422, "invalid_credentials_file")
    version = (db.query(func.max(LawyerApplication.version)).filter_by(user_id=user.id).scalar() or 0) + 1
    application = LawyerApplication(id=new_id(), user_id=user.id, version=version, **payload.model_dump(), status="submitted")
    db.add(application)
    db.flush()
    record_audit(db, user, "lawyer.applied", "lawyer_application", application.id, {"version": version}, request_id)
    commit_event(db, "lawyer.applied", "lawyer_application", application.id, {"user_id": user.id})
    return application


def review_application(db: Session, actor: User, application_id: str, payload: LawyerReview, request_id=""):
    require(actor.has_role("operator"), "仅运营可审核", 403, "forbidden")
    application = db.query(LawyerApplication).filter_by(id=application_id).with_for_update().first()
    require(application is not None, "申请不存在", 404, "not_found")
    require(application.user_id != actor.id, "不能审核本人申请", 403, "self_review_forbidden")
    require(application.status in {"submitted", "under_review"} and application.version == payload.expected_version, "申请已处理或版本改变", 409, "review_conflict")
    user = db.query(User).filter_by(id=application.user_id).with_for_update().one()
    if payload.decision == "approve":
        require(user.is_active and application.expires_on >= date.today(), "账户不可用或证件过期", 422, "invalid_license")
        duplicate = db.query(LawyerProfile).filter(LawyerProfile.user_id != user.id, LawyerProfile.license_number == application.license_number, LawyerProfile.status == "approved").first()
        require(duplicate is None, "证号已用于其他已核准账户", 409, "duplicate_license")
        profile = db.get(LawyerProfile, user.id)
        if profile is None:
            profile = LawyerProfile(user_id=user.id)
            db.add(profile)
        for name in ("firm", "region", "field", "mode", "license_number", "expires_on"):
            setattr(profile, name, getattr(application, name))
        profile.status = "approved"
        profile.available = True
        profile.approved_application_id = application.id
        if not user.has_role("lawyer"):
            user.role_grants.append(UserRole(role="lawyer", source=application.id))
        application.status = "approved"
    else:
        application.status = "rejected" if payload.decision == "reject" else "supplement"
    db.add(LawyerReviewRecord(id=new_id(), application_id=application.id, reviewer_id=actor.id, version=application.version, decision=payload.decision, reason=payload.reason))
    notify(db, user.id, "律师入驻审核进度", payload.reason, "lawyer_application", application.id)
    record_audit(db, actor, "lawyer.reviewed", "lawyer_application", application.id, {"decision": payload.decision, "reason": payload.reason, "review_mode": "operator_approval"}, request_id)
    commit_event(db, "lawyer.reviewed", "lawyer_application", application.id, {"status": application.status})
    db.flush()
    return application


def freeze_lawyer(db: Session, actor: User, lawyer_id: str, reason: str, request_id=""):
    require(actor.has_role("operator"), "仅运营可冻结律师", 403, "forbidden")
    profile = db.query(LawyerProfile).filter_by(user_id=lawyer_id).with_for_update().first()
    require(profile is not None, "律师不存在", 404, "not_found")
    profile.status = "frozen"
    profile.available = False
    record_audit(db, actor, "lawyer.frozen", "lawyer", lawyer_id, {"reason": reason}, request_id)
    notify(db, lawyer_id, "接单权限已冻结", reason, "lawyer", lawyer_id)
    commit_event(db, "lawyer.frozen", "lawyer", lawyer_id, {"reason": reason})
    return profile
