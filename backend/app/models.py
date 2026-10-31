from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, text
from sqlalchemy.types import JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    role: Mapped[str] = mapped_column(String(30), default="client", index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    org_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    token_version: Mapped[int] = mapped_column(Integer, default=0)
    avatar_data: Mapped[str | None] = mapped_column(Text, nullable=True)
    role_grants: Mapped[list["UserRole"]] = relationship(lazy="selectin", cascade="all, delete-orphan")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    @property
    def roles(self) -> list[str]:
        return sorted({grant.role for grant in self.role_grants})

    def has_role(self, role: str) -> bool:
        return role in self.roles


class UserRole(Base):
    __tablename__ = "user_roles"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    role: Mapped[str] = mapped_column(String(30), primary_key=True)
    source: Mapped[str] = mapped_column(String(100), default="registration")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class LawyerProfile(Base):
    __tablename__ = "lawyer_profiles"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    firm: Mapped[str] = mapped_column(String(200), default="")
    region: Mapped[str] = mapped_column(String(100), default="")
    field: Mapped[str] = mapped_column(String(100), default="")
    mode: Mapped[str] = mapped_column(String(100), default="线上服务")
    license_number: Mapped[str] = mapped_column(String(120), default="")
    expires_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="pending", index=True)
    available: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    approved_application_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    bio: Mapped[str] = mapped_column(Text, default="")
    practice_years: Mapped[int] = mapped_column(Integer, default=0)
    specialties: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    __table_args__ = (Index("uq_approved_lawyer_license", "license_number", unique=True, postgresql_where=text("status = 'approved' AND license_number <> ''"), sqlite_where=text("status = 'approved' AND license_number <> ''")),)


class Consultation(Base):
    __tablename__ = "consultations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    topic: Mapped[str] = mapped_column(String(80), default="综合咨询")
    title: Mapped[str] = mapped_column(String(200), default="新的法律咨询")
    status: Mapped[str] = mapped_column(String(30), default="active")
    category: Mapped[str] = mapped_column(String(20), default="unsure")
    intake_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    risk_level: Mapped[str] = mapped_column(String(20), default="normal")
    summary_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class ConsultationMessage(Base):
    __tablename__ = "consultation_messages"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    consultation_id: Mapped[str] = mapped_column(ForeignKey("consultations.id"), index=True)
    role: Mapped[str] = mapped_column(String(20))
    text: Mapped[str] = mapped_column(Text)
    attachments_json: Mapped[list[dict]] = mapped_column(JSON, default=list)
    risk: Mapped[bool] = mapped_column(Boolean, default=False)
    sequence: Mapped[int] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(String(30), default="model")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    __table_args__ = (UniqueConstraint("consultation_id", "sequence", name="uq_consultation_sequence"),)


class ConsultationFeedback(Base):
    __tablename__ = "consultation_feedback"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    consultation_id: Mapped[str] = mapped_column(ForeignKey("consultations.id"), index=True)
    message_id: Mapped[str] = mapped_column(ForeignKey("consultation_messages.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    value: Mapped[str] = mapped_column(String(20))
    reason: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    __table_args__ = (UniqueConstraint("user_id", "message_id", name="uq_feedback_user_message"),)


class Consent(Base):
    __tablename__ = "consents"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    source_id: Mapped[str] = mapped_column(String(36), index=True)
    scope: Mapped[str] = mapped_column(String(100))
    snapshot_hash: Mapped[str] = mapped_column(String(64))
    snapshot_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ServiceRequest(Base):
    __tablename__ = "service_requests"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    source_consultation_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    consent_id: Mapped[str | None] = mapped_column(ForeignKey("consents.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(200))
    domain: Mapped[str] = mapped_column(String(30))
    field: Mapped[str] = mapped_column(String(100))
    service_type: Mapped[str] = mapped_column(String(100))
    facts: Mapped[str] = mapped_column(Text)
    attachments_json: Mapped[list[dict]] = mapped_column(JSON, default=list, server_default="[]")
    region: Mapped[str] = mapped_column(String(100))
    budget: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    deadline: Mapped[date] = mapped_column(Date)
    deliverables: Mapped[str] = mapped_column(Text)
    visibility: Mapped[str] = mapped_column(String(50), default="认证律师可见")
    service_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(30), default="quoting", index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Quote(Base):
    __tablename__ = "quotes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    request_id: Mapped[str] = mapped_column(ForeignKey("service_requests.id"), index=True)
    lawyer_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    scope: Mapped[str] = mapped_column(Text)
    deliverables: Mapped[str] = mapped_column(Text)
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    days: Mapped[int] = mapped_column(Integer)
    payment_terms: Mapped[str] = mapped_column(Text, default="")
    valid_until: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(30), default="valid", index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    __table_args__ = (Index("uq_active_lawyer_quote", "request_id", "lawyer_id", unique=True, postgresql_where=text("status = 'valid'"), sqlite_where=text("status = 'valid'")),)


class LawyerService(Base):
    """律师上架的标准化服务套餐：明码标价，当事人可直接委托，免去发布需求等待报价。"""
    __tablename__ = "lawyer_services"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    lawyer_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(100))
    service_type: Mapped[str] = mapped_column(String(100))
    field: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text)
    deliverables: Mapped[str] = mapped_column(Text)
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    days: Mapped[int] = mapped_column(Integer)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    sold: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Order(Base):
    __tablename__ = "orders"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    request_id: Mapped[str] = mapped_column(ForeignKey("service_requests.id"), index=True)
    quote_id: Mapped[str] = mapped_column(ForeignKey("quotes.id"), unique=True)
    client_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    lawyer_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    scope: Mapped[str] = mapped_column(Text)
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    paid: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    status: Mapped[str] = mapped_column(String(30), default="pending_payment", index=True)
    payment_status: Mapped[str] = mapped_column(String(30), default="unpaid")
    settlement_status: Mapped[str] = mapped_column(String(30), default="frozen")
    deliverables: Mapped[str] = mapped_column(Text, default="")
    days: Mapped[int] = mapped_column(Integer, default=0)
    payment_terms: Mapped[str] = mapped_column(Text, default="")
    client_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lawyer_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_reason: Mapped[str] = mapped_column(String(500), default="")
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    service_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    platform_fee: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    __table_args__ = (Index("uq_active_request_order", "request_id", unique=True, postgresql_where=text("status <> 'cancelled'"), sqlite_where=text("status <> 'cancelled'")),)


class Payment(Base):
    __tablename__ = "payments"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"), index=True)
    provider: Mapped[str] = mapped_column(String(40), default="stub")
    intent_id: Mapped[str] = mapped_column(String(100), unique=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    status: Mapped[str] = mapped_column(String(30), default="created", index=True)
    provider_event_id: Mapped[str | None] = mapped_column(String(150), unique=True, nullable=True)
    merchant_id: Mapped[str] = mapped_column(String(100), default="")
    transaction_id: Mapped[str | None] = mapped_column(String(150), nullable=True)
    client_params: Mapped[dict] = mapped_column(JSON, default=dict)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    refunded: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    __table_args__ = (Index("uq_active_payment_order", "order_id", unique=True, postgresql_where=text("status IN ('creating','created','pending')"), sqlite_where=text("status IN ('creating','created','pending')")),)


class Document(Base):
    __tablename__ = "documents"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"), index=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    doc_type: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(30), default="draft", index=True)
    current_version: Mapped[int] = mapped_column(Integer, default=1)
    locked_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    members_json: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DocumentVersion(Base):
    __tablename__ = "document_versions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), index=True)
    number: Mapped[int] = mapped_column(Integer)
    body: Mapped[str] = mapped_column(Text)
    body_hash: Mapped[str] = mapped_column(String(64))
    author_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    __table_args__ = (UniqueConstraint("document_id", "number", name="uq_document_version"),)


class WorkflowTask(Base):
    __tablename__ = "workflow_tasks"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), index=True)
    version_number: Mapped[int] = mapped_column(Integer)
    sequence: Mapped[int] = mapped_column(Integer)
    assignee_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[str] = mapped_column(String(30), default="pending", index=True)
    reason: Mapped[str] = mapped_column(String(1000), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    __table_args__ = (UniqueConstraint("document_id", "version_number", "sequence", name="uq_workflow_task"),)


class Comment(Base):
    __tablename__ = "document_comments"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), index=True)
    version_number: Mapped[int] = mapped_column(Integer)
    author_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    text: Mapped[str] = mapped_column(Text)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AccessGrant(Base):
    __tablename__ = "document_access_grants"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    can_view: Mapped[bool] = mapped_column(Boolean, default=True)
    can_edit: Mapped[bool] = mapped_column(Boolean, default=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    __table_args__ = (UniqueConstraint("document_id", "user_id", name="uq_document_access"),)


class ChatConversation(Base):
    __tablename__ = "chat_conversations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    client_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    lawyer_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    order_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    last_message_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    client_read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lawyer_read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    __table_args__ = (UniqueConstraint("client_id", "lawyer_id", name="uq_chat_pair"),)


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    conversation_id: Mapped[str] = mapped_column(ForeignKey("chat_conversations.id"), index=True)
    sender_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    text: Mapped[str] = mapped_column(Text)
    attachment_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    __table_args__ = (Index("ix_chat_messages_conversation_created", "conversation_id", "created_at"),)


class Delivery(Base):
    __tablename__ = "deliveries"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"), index=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), nullable=True)
    submitted_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(30), default="submitted")
    reason: Mapped[str] = mapped_column(String(1000), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AfterSalesCase(Base):
    __tablename__ = "after_sales_cases"
    previous_order_status: Mapped[str] = mapped_column(String(30), default="service")
    previous_settlement_status: Mapped[str] = mapped_column(String(30), default="frozen")
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"), index=True)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    case_type: Mapped[str] = mapped_column(String(30))
    reason: Mapped[str] = mapped_column(String(2000))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    status: Mapped[str] = mapped_column(String(30), default="pending", index=True)
    resolution: Mapped[str] = mapped_column(String(2000), default="")
    resolved_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class OrderReview(Base):
    __tablename__ = "order_reviews"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id"), index=True)
    author_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    target_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    rating: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(String(1000), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    __table_args__ = (UniqueConstraint("order_id", "author_id", name="uq_order_review_author"),)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    actor_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(100), index=True)
    object_type: Mapped[str] = mapped_column(String(60))
    object_id: Mapped[str] = mapped_column(String(36), index=True)
    detail_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    request_id: Mapped[str] = mapped_column(String(100), default="")
    ip_address: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(String(2000))
    object_type: Mapped[str] = mapped_column(String(60), default="")
    object_id: Mapped[str] = mapped_column(String(36), default="")
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class StoredFile(Base):
    __tablename__ = "stored_files"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    document_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    original_name: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(150), default="application/octet-stream")
    size: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    storage_path: Mapped[str] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(30), default="available", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class IdempotencyRecord(Base):
    __tablename__ = "idempotency_records"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    key: Mapped[str] = mapped_column(String(180))
    request_hash: Mapped[str] = mapped_column(String(64))
    status_code: Mapped[int] = mapped_column(Integer)
    response_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    __table_args__ = (UniqueConstraint("actor_id", "key", name="uq_idempotency_actor_key"),)


class OutboxEvent(Base):
    __tablename__ = "outbox_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    event_type: Mapped[str] = mapped_column(String(100), index=True)
    aggregate_type: Mapped[str] = mapped_column(String(60))
    aggregate_id: Mapped[str] = mapped_column(String(36), index=True)
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class LawyerApplication(Base):
    __tablename__ = "lawyer_applications"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    firm: Mapped[str] = mapped_column(String(200))
    region: Mapped[str] = mapped_column(String(100))
    field: Mapped[str] = mapped_column(String(100))
    mode: Mapped[str] = mapped_column(String(100))
    license_number: Mapped[str] = mapped_column(String(120))
    expires_on: Mapped[date] = mapped_column(Date)
    credential_file_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(30), default="submitted", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    __table_args__ = (
        UniqueConstraint("user_id", "version", name="uq_lawyer_application_version"),
        Index("uq_lawyer_active_application", "user_id", unique=True, postgresql_where=text("status IN ('submitted','under_review','draft')"), sqlite_where=text("status IN ('submitted','under_review','draft')")),
    )


class LawyerReviewRecord(Base):
    __tablename__ = "lawyer_reviews"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    application_id: Mapped[str] = mapped_column(ForeignKey("lawyer_applications.id"), index=True)
    reviewer_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    version: Mapped[int] = mapped_column(Integer)
    decision: Mapped[str] = mapped_column(String(30))
    reason: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class EmailVerification(Base):
    __tablename__ = "email_verifications"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RegistrationChallenge(Base):
    __tablename__ = "registration_challenges"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    question: Mapped[str] = mapped_column(String(100))
    answer_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PaymentWebhookInbox(Base):
    __tablename__ = "payment_webhook_inbox"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    provider: Mapped[str] = mapped_column(String(40))
    merchant_id: Mapped[str] = mapped_column(String(100))
    event_id: Mapped[str] = mapped_column(String(150))
    body_hash: Mapped[str] = mapped_column(String(64))
    event_json: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(30), default="pending", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    error_code: Mapped[str] = mapped_column(String(80), default="")
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    __table_args__ = (UniqueConstraint("provider", "merchant_id", "event_id", name="uq_payment_inbox_event"),)


class PaymentTransaction(Base):
    __tablename__ = "payment_transactions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    payment_id: Mapped[str] = mapped_column(ForeignKey("payments.id"), index=True)
    provider: Mapped[str] = mapped_column(String(40))
    merchant_id: Mapped[str] = mapped_column(String(100))
    transaction_id: Mapped[str] = mapped_column(String(150))
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    status: Mapped[str] = mapped_column(String(30), default="paid")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    __table_args__ = (UniqueConstraint("provider", "merchant_id", "transaction_id", name="uq_payment_transaction"),)


class Refund(Base):
    __tablename__ = "refunds"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    payment_id: Mapped[str] = mapped_column(ForeignKey("payments.id"), index=True)
    case_id: Mapped[str | None] = mapped_column(ForeignKey("after_sales_cases.id"), nullable=True, unique=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    status: Mapped[str] = mapped_column(String(30), default="pending", index=True)
    provider_refund_id: Mapped[str] = mapped_column(String(150), default="")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class HealthProbe(Base):
    __tablename__ = "health_probes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    value: Mapped[str] = mapped_column(String(100))
