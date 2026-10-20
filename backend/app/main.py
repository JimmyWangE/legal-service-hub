import time
import re
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.exceptions import RequestValidationError
from fastapi.encoders import jsonable_encoder
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, OperationalError

from app.api import admin, auth, chats, consultations, documents, files, marketplace, notifications, orders
from app.bootstrap import seed_demo_data
from app.core.config import get_settings
from app.core.database import SessionLocal, init_db
from app.core.errors import DomainError
from app.core.rate_limit import rate_limiter
from app.services.health import HealthMonitor
from app.core.metrics import export_metrics, observe

settings = get_settings()


@asynccontextmanager
async def lifespan(application: FastAPI):
    init_db()
    db = SessionLocal()
    try:
        seed_demo_data(db)
    finally:
        db.close()
    monitor = HealthMonitor()
    application.state.health = monitor
    await monitor.collect()
    monitor.start()
    try:
        yield
    finally:
        await monitor.stop()


app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origin_list, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def request_context_middleware(request: Request, call_next):
    started = time.perf_counter()
    supplied = request.headers.get("X-Request-Id", "")
    request.state.request_id = supplied if re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", supplied) else str(uuid4())
    if request.url.path.startswith("/api/") and not request.url.path.startswith("/api/v1/payments/webhooks/"):
        client_ip = request.client.host if request.client else "unknown"
        authorization = request.headers.get("Authorization", "")
        principal = client_ip
        if authorization.startswith("Bearer "):
            from app.core.security import decode_access_token

            try:
                principal = "user:" + decode_access_token(authorization[7:])["sub"]
            except DomainError:
                pass
        try:
            allowed = rate_limiter.allow(principal)
        except DomainError as exc:
            return JSONResponse(status_code=exc.status_code, content={"error": {"code": exc.code, "message": exc.message}}, headers={"X-Request-Id": request.state.request_id})
        if not allowed:
            observe(request, 429, started)
            return JSONResponse(status_code=429, content={"error": {"code": "rate_limited", "message": "请求过于频繁，请稍后重试"}}, headers={"X-Request-Id": request.state.request_id})
    try:
        response = await call_next(request)
    except Exception:
        observe(request, 500, started)
        raise
    observe(request, response.status_code, started)
    response.headers["X-Request-Id"] = request.state.request_id
    response.headers["X-Process-Time"] = f"{time.perf_counter() - started:.6f}"
    return response


@app.exception_handler(DomainError)
async def domain_error_handler(_: Request, exc: DomainError):
    return JSONResponse(status_code=exc.status_code, content={"error": {"code": exc.code, "message": exc.message}})


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError):
    details = [{"loc": item["loc"], "type": item["type"], "message": item["msg"]} for item in exc.errors()]
    return JSONResponse(status_code=422, content=jsonable_encoder({"error": {"code": "validation_error", "message": "请求参数校验失败", "details": details}}))


@app.exception_handler(IntegrityError)
async def integrity_error_handler(_: Request, exc: IntegrityError):
    return JSONResponse(status_code=409, content={"error": {"code": "data_conflict", "message": "数据已发生变化，请刷新后重试"}})


@app.exception_handler(OperationalError)
async def database_error_handler(_: Request, exc: OperationalError):
    return JSONResponse(status_code=503, content={"error": {"code": "database_unavailable", "message": "数据服务暂不可用，请沿用幂等键稍后重试"}})


@app.get("/health/live", tags=["system"])
def liveness():
    return {"status": "ok"}


@app.get("/health/ready", tags=["system"])
def readiness(request: Request):
    code, snapshot = request.app.state.health.snapshot()
    return JSONResponse(status_code=code, content=snapshot)


@app.get("/health/ready/model", tags=["system"])
def model_readiness(request: Request):
    code, snapshot = request.app.state.health.snapshot(model_required=True)
    return JSONResponse(status_code=code, content=snapshot)


@app.get("/api/v1/capabilities", tags=["system"])
def capabilities(request: Request):
    return {"payment_provider": settings.payment_provider, "payments_enabled": settings.payment_provider != "disabled", "payment_simulation_enabled": settings.app_env != "production" and settings.payment_provider == "stub" and settings.payment_stub_enabled, "model_provider": settings.model_provider, "attachments_used_by_model": False, "email_verification_enabled": False, "registration_challenge_enabled": True, "consultation_available": request.app.state.health.snapshot()[1]["capabilities"]["consultation"]}


@app.get("/metrics", tags=["system"])
def metrics(request: Request):
    content, content_type = export_metrics(request.app.state.health)
    return Response(content=content, headers={"Content-Type": content_type})


api_prefix = "/api/v1"
for router in (auth.router, chats.router, consultations.router, marketplace.router, orders.router, documents.router, files.router, notifications.router, admin.router):
    app.include_router(router, prefix=api_prefix)
app.include_router(consultations.stream_router, prefix=api_prefix)
app.include_router(chats.stream_router, prefix=api_prefix)
