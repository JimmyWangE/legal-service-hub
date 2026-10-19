import hashlib
import re
from pathlib import Path

from fastapi import UploadFile
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import DomainError
from app.models import AccessGrant, Document, StoredFile, User
from app.services.common import new_id, record_audit


ALLOWED_EXTENSIONS = {".pdf", ".doc", ".docx", ".txt", ".png", ".jpg", ".jpeg"}


def safe_name(name: str) -> str:
    name = Path(name or "upload.bin").name
    return re.sub(r"[^\w.\-\u4e00-\u9fff ]", "_", name)[:180]


def upload(db: Session, user: User, file: UploadFile, document_id: str | None = None, request_id: str = "") -> StoredFile:
    settings = get_settings()
    name = safe_name(file.filename or "upload.bin")
    if Path(name).suffix.lower() not in ALLOWED_EXTENSIONS:
        raise DomainError("不支持的文件格式", 422, "unsupported_file")
    if document_id:
        document = db.get(Document, document_id)
        grant = db.query(AccessGrant).filter_by(document_id=document_id, user_id=user.id, can_view=True).first()
        if not document or not grant or grant.revoked_at is not None or not grant.can_edit:
            raise DomainError("无权关联此文书", 403, "forbidden")
    file_id = new_id()
    target_dir = Path(settings.upload_dir) / user.id
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{file_id}{Path(name).suffix.lower()}"
    digest = hashlib.sha256()
    size = 0
    try:
        with target.open("xb") as output:
            while True:
                chunk = file.file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > settings.max_upload_bytes:
                    raise DomainError("文件超过大小限制", 413, "file_too_large")
                digest.update(chunk)
                output.write(chunk)
    except Exception:
        target.unlink(missing_ok=True)
        raise
    stored = StoredFile(id=file_id, owner_id=user.id, document_id=document_id, original_name=name, content_type=file.content_type or "application/octet-stream", size=size, sha256=digest.hexdigest(), storage_path=str(target), status="available")
    db.info.setdefault("new_files", []).append(target)
    db.add(stored)
    record_audit(db, user, "file.uploaded", "file", stored.id, {"size": size, "sha256": stored.sha256}, request_id)
    db.flush()
    db.refresh(stored)
    return stored
