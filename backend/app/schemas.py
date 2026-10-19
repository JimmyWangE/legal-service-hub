from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class APIModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str
    name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=8, max_length=128)
    registration_intent: Literal["client", "lawyer"] = "client"
    challenge_id: str = Field(min_length=36, max_length=36)
    challenge_answer: str = Field(min_length=1, max_length=16)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value):
        value = value.strip().lower()
        if len(value) > 255 or "@" not in value or any(character.isspace() for character in value):
            raise ValueError("invalid email")
        return value

    @field_validator("name", "challenge_id", "challenge_answer", mode="before")
    @classmethod
    def strip_registration_values(cls, value):
        return value.strip() if isinstance(value, str) else value


class UserOut(APIModel):
    id: str
    email: str
    name: str
    role: str
    roles: list[str] = Field(default_factory=list)
    email_verified: bool = False
    org_id: str | None = None


class RegistrationChallengeOut(BaseModel):
    id: str
    question: str
    expires_at: datetime


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class ConsultationCreate(BaseModel):
    topic: str = Field(default="综合咨询", max_length=80)
    title: str | None = Field(default=None, max_length=200)


class MessageCreate(BaseModel):
    prompt: str = Field(min_length=2, max_length=8000)
    topic: str = Field(default="综合咨询", max_length=80)
    attachments: list[dict[str, Any]] = Field(default_factory=list, max_length=8)
    context_enabled: bool = True


class FeedbackCreate(BaseModel):
    message_id: str
    value: Literal["有用", "无用"]
    reason: str = Field(default="", max_length=500)


class SummaryCreate(BaseModel):
    scope: str = Field(default="咨询提问摘要", max_length=100)
    consent: bool


class RequestCreate(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    domain: str = Field(min_length=1, max_length=30)
    field: str = Field(min_length=1, max_length=100)
    service_type: str = Field(min_length=1, max_length=100)
    facts: str = Field(min_length=8, max_length=12000)
    region: str = Field(min_length=1, max_length=100)
    budget: Decimal = Field(gt=0, le=Decimal("100000000"))
    deadline: date
    deliverables: str = Field(min_length=1, max_length=5000)
    visibility: Literal["认证律师可见"] = "认证律师可见"
    source_consultation_id: str | None = None
    consent: bool = False
    consent_id: str | None = None


class QuoteCreate(BaseModel):
    scope: str = Field(min_length=1, max_length=5000)
    deliverables: str = Field(min_length=1, max_length=5000)
    price: Decimal = Field(gt=0, le=Decimal("100000000"))
    days: int = Field(gt=0, le=3650)
    valid_until: date


class DocumentCreate(BaseModel):
    order_id: str
    title: str = Field(min_length=1, max_length=200)
    doc_type: Literal["service_contract", "legal_document", "attachment", "delivery"] = "legal_document"
    body: str = Field(min_length=1, max_length=2_000_000)
    members: list[str] = Field(default_factory=list, max_length=20)


class VersionCreate(BaseModel):
    body: str = Field(min_length=1, max_length=2_000_000)
    base_version: int = Field(gt=0)


class WorkflowStart(BaseModel):
    assignee_ids: list[str] = Field(min_length=1, max_length=20)


class WorkflowAction(BaseModel):
    version: int = Field(gt=0)
    reason: str = Field(default="", max_length=1000)


class CommentCreate(BaseModel):
    version: int = Field(gt=0)
    text: str = Field(min_length=1, max_length=5000)


class PaymentCreate(BaseModel):
    amount: Decimal | None = Field(default=None, gt=0)
    provider: str | None = Field(default=None, max_length=40)


class PaymentWebhook(BaseModel):
    event_id: str
    intent_id: str
    status: Literal["success", "failed"]
    amount: Decimal = Field(gt=0)


class DeliveryCreate(BaseModel):
    document_id: str | None = None


class AfterSalesCreate(BaseModel):
    case_type: Literal["refund", "dispute"]
    reason: str = Field(min_length=2, max_length=2000)
    amount: Decimal = Field(default=Decimal("0"), ge=0)


class CaseResolve(BaseModel):
    decision: Literal["approve", "reject"]
    resolution: str = Field(min_length=2, max_length=2000)


class LawyerApply(BaseModel):
    model_config = ConfigDict(extra="forbid")
    firm: str = Field(min_length=1, max_length=200)
    region: str = Field(min_length=1, max_length=100)
    field: str = Field(min_length=1, max_length=100)
    mode: str = Field(min_length=1, max_length=100)
    license_number: str = Field(min_length=1, max_length=120)
    expires_on: date
    credential_file_ids: list[str] = Field(default_factory=list, max_length=10)


class LawyerReview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: Literal["approve", "reject", "supplement"]
    reason: str = Field(min_length=2, max_length=2000)
    expected_version: int = Field(ge=1)
    qualification_verified: bool | None = Field(default=None, description="兼容旧客户端字段，实际审核依据为管理员决定")


class FreezeLawyer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(min_length=2, max_length=2000)


class VerifyEmail(BaseModel):
    token: str = Field(min_length=32, max_length=200)


class PasswordChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    old_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)


class NotificationOut(APIModel):
    id: str
    title: str
    body: str
    object_type: str
    object_id: str
    read_at: datetime | None
    created_at: datetime
