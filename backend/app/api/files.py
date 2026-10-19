from app.core.idempotency import TransactionalRouter
from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import current_user, request_context
from app.core.errors import require
from app.models import AccessGrant, Document, StoredFile, User
from app.services import files

router = TransactionalRouter(prefix="/files", tags=["files"])


@router.post("")
def upload_file(file: UploadFile = File(...), document_id: str | None = Form(default=None), db: Session = Depends(get_db), user: User = Depends(current_user), context=Depends(request_context)):
    stored = files.upload(db, user, file, document_id, context["request_id"])
    return {"id": stored.id, "name": stored.original_name, "content_type": stored.content_type, "size": stored.size, "sha256": stored.sha256, "status": stored.status}


@router.get("/{file_id}")
def download_file(file_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    stored = db.get(StoredFile, file_id)
    require(stored is not None and stored.status == "available", "文件不存在", 404, "not_found")
    if stored.document_id:
        grant = db.query(AccessGrant).filter_by(document_id=stored.document_id, user_id=user.id, can_view=True).first()
        allowed = bool(grant and grant.revoked_at is None)
    else:
        allowed = stored.owner_id == user.id
    require(allowed, "无权访问此文件", 403, "forbidden")
    return FileResponse(stored.storage_path, filename=stored.original_name, media_type="application/octet-stream", headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})
