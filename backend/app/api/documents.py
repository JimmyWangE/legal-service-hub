from app.core.idempotency import TransactionalRouter
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.serializers import document_out
from app.core.database import get_db
from app.core.deps import current_user, request_context
from app.core.errors import require
from app.models import AccessGrant, Comment, Document, DocumentVersion, Order, StoredFile, User
from app.schemas import CommentCreate, DocumentCreate, VersionCreate, WorkflowAction, WorkflowStart
from app.services import documents

router = TransactionalRouter(tags=["documents"])


@router.get("/documents")
def list_documents(order_id: str | None = None, offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100), db: Session = Depends(get_db), user: User = Depends(current_user)):
    query = db.query(Document)
    if not user.has_role("operator"):
        visible_ids = db.query(AccessGrant.document_id).filter(AccessGrant.user_id == user.id, AccessGrant.can_view.is_(True), AccessGrant.revoked_at.is_(None))
        query = query.filter(Document.id.in_(visible_ids))
    if order_id:
        query = query.filter(Document.order_id == order_id)
    return [document_out(db, item, include_body=False) for item in query.order_by(Document.created_at.desc()).offset(offset).limit(limit).all()]


@router.post("/documents")
def create_document(payload: DocumentCreate, db: Session = Depends(get_db), user: User = Depends(current_user), context=Depends(request_context)):
    return document_out(db, documents.create(db, user, payload, context["request_id"]))


@router.get("/documents/{document_id}")
def get_document(document_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    document = documents.get_document(db, user, document_id)
    include_body = not user.has_role("operator")
    result = document_out(db, document, include_body=include_body)
    result["can_edit"] = documents.can_edit(db, user, document)
    result["comments"] = [{"id": item.id, "version": item.version_number, "text": item.text, "created_at": item.created_at} for item in db.query(Comment).filter_by(document_id=document.id).order_by(Comment.created_at).limit(100).all()] if include_body else []
    result["files"] = [{"id": item.id, "name": item.original_name, "size": item.size} for item in db.query(StoredFile).filter_by(document_id=document.id, status="available").limit(100).all()] if include_body else []
    return result


@router.post("/documents/{document_id}/versions")
def create_version(document_id: str, payload: VersionCreate, db: Session = Depends(get_db), user: User = Depends(current_user), context=Depends(request_context)):
    version = documents.create_version(db, user, document_id, payload, context["request_id"])
    return {"id": version.id, "document_id": version.document_id, "number": version.number, "body_hash": version.body_hash, "created_at": version.created_at}


@router.get("/documents/{document_id}/versions/{number}")
def historical_version(document_id: str, number: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    documents.get_document(db, user, document_id)
    require(not user.has_role("operator"), "运营不可直接读取正文", 403, "forbidden")
    item = db.query(DocumentVersion).filter_by(document_id=document_id, number=number).first()
    require(item is not None, "版本不存在", 404, "not_found")
    return {"number": item.number, "body": item.body, "body_hash": item.body_hash, "created_at": item.created_at}


@router.post("/documents/{document_id}/workflow")
def start_workflow(document_id: str, payload: WorkflowStart, db: Session = Depends(get_db), user: User = Depends(current_user), context=Depends(request_context)):
    return document_out(db, documents.start_workflow(db, user, document_id, payload, context["request_id"]))


@router.post("/documents/{document_id}/workflow/confirm")
def confirm_workflow(document_id: str, payload: WorkflowAction, db: Session = Depends(get_db), user: User = Depends(current_user), context=Depends(request_context)):
    return document_out(db, documents.act_on_workflow(db, user, document_id, "confirm", payload, context["request_id"]))


@router.post("/documents/{document_id}/workflow/return")
def return_workflow(document_id: str, payload: WorkflowAction, db: Session = Depends(get_db), user: User = Depends(current_user), context=Depends(request_context)):
    return document_out(db, documents.act_on_workflow(db, user, document_id, "return", payload, context["request_id"]))


@router.post("/documents/{document_id}/comments")
def add_comment(document_id: str, payload: CommentCreate, db: Session = Depends(get_db), user: User = Depends(current_user), context=Depends(request_context)):
    comment = documents.add_comment(db, user, document_id, payload, context["request_id"])
    return {"id": comment.id, "document_id": comment.document_id, "version": comment.version_number, "author_id": comment.author_id, "text": comment.text, "resolved": comment.resolved, "created_at": comment.created_at}


@router.post("/documents/{document_id}/access/{member_id}/revoke")
def revoke_access(document_id: str, member_id: str, db: Session = Depends(get_db), user: User = Depends(current_user), context=Depends(request_context)):
    grant = documents.revoke_access(db, user, document_id, member_id, context["request_id"])
    return {"document_id": grant.document_id, "user_id": grant.user_id, "revoked_at": grant.revoked_at}
