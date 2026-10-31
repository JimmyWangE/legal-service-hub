from app.core.idempotency import TransactionalRouter
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import current_user
from app.core.security import create_access_token
from app.schemas import AvatarUpdate, LoginRequest, LoginResponse, PasswordChange, ProfileUpdate, RegisterRequest, RegistrationChallengeOut
from app.services.identity import create_registration_challenge, login, register
from app.api.serializers import user_out

router = TransactionalRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
def login_endpoint(payload: LoginRequest, db: Session = Depends(get_db)):
    user = login(db, payload.email, payload.password)
    return {"access_token": create_access_token(user.id, user.role, user.token_version), "user": user_out(user)}


@router.post("/register", response_model=LoginResponse)
def register_endpoint(payload: RegisterRequest, db: Session = Depends(get_db)):
    user = register(db, payload)
    return {"access_token": create_access_token(user.id, user.role, user.token_version), "user": user_out(user)}


@router.get("/registration-challenge", response_model=RegistrationChallengeOut)
def registration_challenge(db: Session = Depends(get_db)):
    challenge = create_registration_challenge(db)
    return {"id": challenge.id, "question": challenge.question, "expires_at": challenge.expires_at}


@router.get("/me")
def me(db: Session = Depends(get_db), user=Depends(current_user)):
    from app.models import LawyerApplication, LawyerProfile
    from app.services.marketplace import active_lawyer

    result = user_out(user)
    profile = db.get(LawyerProfile, user.id)
    result["lawyer_profile"] = {"status": profile.status, "expires_on": profile.expires_on, "available": profile.available, "can_quote": active_lawyer(user, profile), "firm": profile.firm, "region": profile.region, "field": profile.field, "mode": profile.mode, "bio": profile.bio or "", "practice_years": profile.practice_years or 0, "specialties": profile.specialties or []} if profile else None
    application = db.query(LawyerApplication).filter_by(user_id=user.id).order_by(LawyerApplication.version.desc()).first()
    result["lawyer_application"] = {"id": application.id, "status": application.status, "version": application.version} if application else None
    return result


@router.post("/password")
def change_password(payload: PasswordChange, db: Session = Depends(get_db), user=Depends(current_user)):
    from app.core.errors import require
    from app.core.security import hash_password, verify_password
    from app.services.common import record_audit

    require(verify_password(payload.old_password, user.password_hash), "原密码错误", 403, "invalid_credentials")
    user.password_hash = hash_password(payload.new_password)
    user.token_version += 1
    record_audit(db, user, "password.changed", "user", user.id)
    return {"changed": True, "reauthentication_required": True}


@router.post("/avatar")
def update_avatar(payload: AvatarUpdate, db: Session = Depends(get_db), user=Depends(current_user)):
    from app.services.identity import update_avatar as apply_avatar

    apply_avatar(db, user, payload.data_url)
    return user_out(user)


@router.patch("/me")
def update_me(payload: ProfileUpdate, db: Session = Depends(get_db), user=Depends(current_user)):
    from app.services.common import record_audit

    user.name = payload.name
    record_audit(db, user, "user.profile.updated", "user", user.id)
    return user_out(user)


@router.post("/refresh", response_model=LoginResponse)
def refresh_session(user=Depends(current_user)):
    """仍有效的访问令牌可换取新令牌，活跃用户不会在操作中途掉线；改密后旧令牌因版本号失效无法续期。"""
    return {"access_token": create_access_token(user.id, user.role, user.token_version), "user": user_out(user)}
