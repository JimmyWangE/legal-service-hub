import asyncio
import json
from datetime import datetime
from time import monotonic

from fastapi import APIRouter, Depends, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.core.database import SessionLocal, get_db
from app.core.deps import current_user, request_context
from app.core.idempotency import TransactionalRouter
from app.models import User
from app.schemas import ChatCreate, ChatMessageCreate
from app.services import chat

router = TransactionalRouter(prefix="/chats", tags=["chats"])
stream_router = APIRouter(prefix="/chats", tags=["chats"])
STREAM_LIFETIME_SECONDS = 170
PING_SECONDS = 15


@router.get("")
def list_chats(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return chat.list_conversations(db, user)


@router.post("")
def open_chat(payload: ChatCreate, db: Session = Depends(get_db), user: User = Depends(current_user), context=Depends(request_context)):
    conversation = chat.open_conversation(db, user, payload.peer_id, payload.order_id, context["request_id"])
    return chat.conversations_out(db, user, [conversation])[0]


@router.get("/unread-count")
def unread_count(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"unread": chat.unread_total(db, user)}


@router.get("/{conversation_id}/messages")
def messages(conversation_id: str, before: datetime | None = Query(default=None), limit: int = Query(50, ge=1, le=100), db: Session = Depends(get_db), user: User = Depends(current_user)):
    return chat.list_messages(db, user, conversation_id, before, limit)


@router.post("/{conversation_id}/messages")
def send(conversation_id: str, payload: ChatMessageCreate, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return chat.message_out(chat.send_message(db, user, conversation_id, payload.text, payload.file_id))


@router.get("/{conversation_id}/files/{file_id}")
def download(conversation_id: str, file_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    stored = chat.get_attachment(db, user, conversation_id, file_id)
    return FileResponse(stored.storage_path, filename=stored.original_name, media_type="application/octet-stream", headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


@router.post("/{conversation_id}/read")
def read(conversation_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    chat.mark_read(db, user, conversation_id)
    return {"ok": True}


def _event(name: str, data: dict) -> str:
    return f"event: {name}\ndata: {json.dumps(jsonable_encoder(data), ensure_ascii=False)}\n\n"


def _poll(user_id: str, cursor, seen: set[str]):
    db = SessionLocal()
    try:
        return chat.poll_new(db, user_id, cursor, seen)
    finally:
        db.close()


@stream_router.get("/stream")
async def stream(request: Request, since: str | None = Query(default=None, max_length=64), user: User = Depends(current_user)):
    user_id = user.id
    cursor = chat.parse_since(since)

    async def events():
        nonlocal cursor
        seen: set[str] = set()
        started = last_ping = monotonic()
        yield _event("ready", {"cursor": cursor})
        while monotonic() - started < STREAM_LIFETIME_SECONDS:
            if await request.is_disconnected():
                return
            for item in await run_in_threadpool(_poll, user_id, cursor, seen):
                if item["created_at"] != cursor:
                    cursor, seen = item["created_at"], set()
                seen.add(item["id"])
                yield _event("message", item)
            if monotonic() - last_ping >= PING_SECONDS:
                last_ping = monotonic()
                yield _event("ping", {"cursor": cursor})
            await asyncio.sleep(1)
        yield _event("reconnect", {"cursor": cursor})

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive"})
