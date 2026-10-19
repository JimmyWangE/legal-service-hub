from collections.abc import Generator

from fastapi import Depends, Header, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import DomainError
from app.core.security import decode_access_token
from app.models import User

bearer = HTTPBearer(auto_error=False)


def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if not credentials:
        raise HTTPException(status_code=401, detail={"code": "missing_token", "message": "请先登录"})
    try:
        payload = decode_access_token(credentials.credentials)
    except DomainError as exc:
        raise HTTPException(status_code=exc.status_code, detail={"code": exc.code, "message": exc.message}) from exc
    user = db.get(User, payload["sub"])
    if not user or not user.is_active or payload.get("version", 0) != user.token_version:
        raise HTTPException(status_code=401, detail={"code": "inactive_user", "message": "账户不可用"})
    return user


def optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User | None:
    if not credentials:
        return None
    try:
        payload = decode_access_token(credentials.credentials)
    except DomainError:
        return None
    return db.get(User, payload["sub"])


def require_roles(*roles: str):
    def dependency(user: User = Depends(current_user)) -> User:
        if not any(user.has_role(role) for role in roles):
            raise HTTPException(status_code=403, detail={"code": "forbidden", "message": "无权执行此操作"})
        return user

    return dependency


def request_context(
    request: Request,
    x_request_id: str | None = Header(default=None),
) -> dict[str, str]:
    request_id = x_request_id or request.state.request_id
    return {"request_id": request_id, "ip": request.client.host if request.client else ""}


def idempotency_key(value: str | None = Header(default=None, alias="Idempotency-Key")) -> str | None:
    return value
