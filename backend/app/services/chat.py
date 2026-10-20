from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.api.serializers import user_briefs
from app.core.errors import require
from app.models import ChatConversation, ChatMessage, LawyerProfile, Order, Quote, ServiceRequest, StoredFile, User
from app.services.common import new_id, record_audit
from app.services.marketplace import active_lawyer


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def side(conversation: ChatConversation, user_id: str) -> str:
    return "client" if conversation.client_id == user_id else "lawyer"


def get_conversation(db: Session, user: User, conversation_id: str) -> ChatConversation:
    conversation = db.get(ChatConversation, conversation_id)
    require(conversation is not None and user.id in (conversation.client_id, conversation.lawyer_id), "会话不存在或无权访问", 404, "not_found")
    return conversation


def _lawyer_has_relation(db: Session, lawyer_id: str, client_id: str) -> bool:
    if db.query(Order.id).filter_by(lawyer_id=lawyer_id, client_id=client_id).first():
        return True
    return db.query(Quote.id).join(ServiceRequest, ServiceRequest.id == Quote.request_id).filter(Quote.lawyer_id == lawyer_id, ServiceRequest.owner_id == client_id).first() is not None


def open_conversation(db: Session, user: User, peer_id: str, order_id: str | None = None, request_id: str = "") -> ChatConversation:
    require(peer_id != user.id, "不能与自己建立会话", 422, "invalid_peer")
    peer = db.get(User, peer_id)
    require(peer is not None and peer.is_active, "对方账户不存在或不可用", 404, "not_found")
    if order_id:
        order = db.get(Order, order_id)
        require(order is not None and {user.id, peer.id} == {order.client_id, order.lawyer_id}, "无权基于此订单发起会话", 403, "forbidden")
        client_id, lawyer_id = order.client_id, order.lawyer_id
    elif user.has_role("client") and active_lawyer(peer, db.get(LawyerProfile, peer.id)):
        client_id, lawyer_id = user.id, peer.id
    elif active_lawyer(user, db.get(LawyerProfile, user.id)) and _lawyer_has_relation(db, user.id, peer.id):
        client_id, lawyer_id = peer.id, user.id
    else:
        require(False, "仅可与认证律师或已有报价、订单往来的当事人交流", 403, "forbidden")
    conversation = db.query(ChatConversation).filter_by(client_id=client_id, lawyer_id=lawyer_id).first()
    if conversation:
        if order_id and not conversation.order_id:
            conversation.order_id = order_id
        return conversation
    conversation = ChatConversation(id=new_id(), client_id=client_id, lawyer_id=lawyer_id, order_id=order_id)
    db.add(conversation)
    record_audit(db, user, "chat.opened", "chat", conversation.id, {"peer_id": peer.id}, request_id)
    db.flush()
    return conversation


def message_out(message: ChatMessage) -> dict:
    return {"id": message.id, "conversation_id": message.conversation_id, "sender_id": message.sender_id, "text": message.text, "attachment": message.attachment_json, "created_at": message.created_at}


def _unread_counts(db: Session, user_id: str, conversations: list[ChatConversation]) -> dict[str, int]:
    if not conversations:
        return {}
    clauses = []
    for item in conversations:
        read_at = item.client_read_at if side(item, user_id) == "client" else item.lawyer_read_at
        clause = ChatMessage.conversation_id == item.id
        clauses.append(and_(clause, ChatMessage.created_at > read_at) if read_at else clause)
    rows = db.query(ChatMessage.conversation_id, func.count(ChatMessage.id)).filter(ChatMessage.sender_id != user_id, or_(*clauses)).group_by(ChatMessage.conversation_id).all()
    return dict(rows)


def conversations_out(db: Session, user: User, conversations: list[ChatConversation]) -> list[dict]:
    people = user_briefs(db, [item.lawyer_id if side(item, user.id) == "client" else item.client_id for item in conversations])
    unread = _unread_counts(db, user.id, conversations)
    output = []
    for item in conversations:
        mine = side(item, user.id)
        peer_id = item.lawyer_id if mine == "client" else item.client_id
        last = db.query(ChatMessage).filter_by(conversation_id=item.id).order_by(ChatMessage.created_at.desc()).first()
        output.append({
            "id": item.id, "my_side": mine, "order_id": item.order_id, "last_message_at": item.last_message_at,
            "peer": {**people.get(peer_id, {"id": peer_id, "name": "未知用户", "avatar": None}), "side": "lawyer" if mine == "client" else "client"},
            "last_message": message_out(last) if last else None, "unread": unread.get(item.id, 0),
        })
    return output


def list_conversations(db: Session, user: User) -> list[dict]:
    items = db.query(ChatConversation).filter(or_(ChatConversation.client_id == user.id, ChatConversation.lawyer_id == user.id)).order_by(ChatConversation.last_message_at.desc()).limit(100).all()
    return conversations_out(db, user, items)


def list_messages(db: Session, user: User, conversation_id: str, before: datetime | None, limit: int) -> list[dict]:
    get_conversation(db, user, conversation_id)
    query = db.query(ChatMessage).filter_by(conversation_id=conversation_id)
    if before:
        query = query.filter(ChatMessage.created_at < before)
    return [message_out(item) for item in query.order_by(ChatMessage.created_at.desc()).limit(limit).all()[::-1]]


def send_message(db: Session, user: User, conversation_id: str, text: str, file_id: str | None = None) -> ChatMessage:
    conversation = get_conversation(db, user, conversation_id)
    attachment = None
    if file_id:
        stored = db.get(StoredFile, file_id)
        require(stored is not None and stored.owner_id == user.id and stored.document_id is None and stored.status == "available", "文件不存在或无权发送", 403, "forbidden")
        attachment = {"file_id": stored.id, "name": stored.original_name, "size": stored.size, "content_type": stored.content_type}
    message = ChatMessage(id=new_id(), conversation_id=conversation.id, sender_id=user.id, text=text, attachment_json=attachment, created_at=utcnow())
    db.add(message)
    conversation.last_message_at = message.created_at
    if side(conversation, user.id) == "client":
        conversation.client_read_at = message.created_at
    else:
        conversation.lawyer_read_at = message.created_at
    db.flush()
    return message


def get_attachment(db: Session, user: User, conversation_id: str, file_id: str) -> StoredFile:
    """会话双方都可下载会话中发送过的文件；文件未出现在本会话中时按不存在处理。"""
    conversation = get_conversation(db, user, conversation_id)
    sent = db.query(ChatMessage.id).filter(ChatMessage.conversation_id == conversation.id, ChatMessage.attachment_json.is_not(None), ChatMessage.attachment_json["file_id"].as_string() == file_id).first()
    stored = db.get(StoredFile, file_id)
    require(sent is not None and stored is not None and stored.status == "available", "文件不存在", 404, "not_found")
    return stored


def mark_read(db: Session, user: User, conversation_id: str) -> ChatConversation:
    conversation = get_conversation(db, user, conversation_id)
    if side(conversation, user.id) == "client":
        conversation.client_read_at = utcnow()
    else:
        conversation.lawyer_read_at = utcnow()
    db.flush()
    return conversation


def unread_total(db: Session, user: User) -> int:
    items = db.query(ChatConversation).filter(or_(ChatConversation.client_id == user.id, ChatConversation.lawyer_id == user.id)).all()
    return sum(_unread_counts(db, user.id, items).values())


def poll_new(db: Session, user_id: str, cursor: datetime, seen: set[str]) -> list[dict]:
    """返回游标之后的新消息；同一时间戳的消息按 id 去重，避免并发写入被跳过。"""
    mine = db.query(ChatConversation.id).filter(or_(ChatConversation.client_id == user_id, ChatConversation.lawyer_id == user_id))
    items = db.query(ChatMessage).filter(ChatMessage.conversation_id.in_(mine), ChatMessage.created_at >= cursor).order_by(ChatMessage.created_at).limit(200).all()
    return [message_out(item) for item in items if item.id not in seen]


def parse_since(value: str | None) -> datetime:
    floor = utcnow() - timedelta(days=1)
    if not value:
        return utcnow()
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return utcnow()
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return max(parsed, floor)
