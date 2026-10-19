from contextvars import ContextVar
from decimal import Decimal
from functools import wraps
import hashlib
import inspect
import json

from fastapi import APIRouter, Request, Response
from fastapi.encoders import jsonable_encoder
from fastapi.routing import APIRoute
from sqlalchemy.exc import IntegrityError

from app.core.errors import DomainError, require
from app.models import IdempotencyRecord, User
from app.services.common import new_id


active_request = ContextVar("active_request", default=None)


def encode(value):
    if isinstance(value, Response):
        return value
    return jsonable_encoder(value, custom_encoder={Decimal: str})


def execute(endpoint, arguments):
    request = active_request.get()
    db = arguments.get("db")
    user = arguments.get("user")
    key = request.headers.get("Idempotency-Key") if request else None
    if not key or request.method not in {"POST", "PUT", "PATCH", "DELETE"} or db is None or not isinstance(user, User):
        return encode(endpoint(**arguments))
    require(len(key) <= 128 and key.isascii() and key.isprintable(), "幂等键格式不正确", 422, "invalid_idempotency_key")
    scope = f"{request.method}:{request.url.path}:{key}"
    scoped_key = hashlib.sha256(scope.encode()).hexdigest()
    payload = {name: value.model_dump(mode="json") if hasattr(value, "model_dump") else value for name, value in arguments.items() if name not in {"db", "user", "context", "key"}}
    if any(hasattr(value, "file") for value in payload.values()):
        return encode(endpoint(**arguments))
    digest = hashlib.sha256(json.dumps(encode(payload), ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

    def replay(record):
        require(record.request_hash == digest, "幂等键不能复用到不同请求", 409, "idempotency_conflict")
        require(record.status_code != 0, "请求仍在处理中", 409, "idempotency_in_progress")
        return record.response_json

    record = db.query(IdempotencyRecord).filter_by(actor_id=user.id, key=scoped_key).first()
    if record:
        return replay(record)
    record = IdempotencyRecord(id=new_id(), actor_id=user.id, key=scoped_key, request_hash=digest, status_code=0, response_json={})
    try:
        with db.begin_nested():
            db.add(record)
            db.flush()
    except IntegrityError:
        winner = db.query(IdempotencyRecord).filter_by(actor_id=user.id, key=scoped_key).first()
        if winner:
            return replay(winner)
        raise DomainError("并发请求冲突，请沿用幂等键重试", 409, "idempotency_in_progress")
    result = encode(endpoint(**arguments))
    require(not isinstance(result, Response), "此入口不支持幂等响应", 422, "invalid_idempotency_endpoint")
    record.status_code = 200
    record.response_json = result
    db.flush()
    return result


class TransactionalRoute(APIRoute):
    def __init__(self, path, endpoint, **kwargs):
        if not inspect.iscoroutinefunction(endpoint) and not getattr(endpoint, "_transactional_wrapped", False):
            original = endpoint

            @wraps(original)
            def wrapped(**arguments):
                return execute(original, arguments)

            wrapped._transactional_wrapped = True
            endpoint = wrapped
        super().__init__(path, endpoint, **kwargs)

    def get_route_handler(self):
        handler = super().get_route_handler()

        async def route_handler(request: Request):
            token = active_request.set(request)
            try:
                return await handler(request)
            finally:
                active_request.reset(token)

        return route_handler


class TransactionalRouter(APIRouter):
    def __init__(self, *args, **kwargs):
        kwargs["route_class"] = TransactionalRoute
        super().__init__(*args, **kwargs)
