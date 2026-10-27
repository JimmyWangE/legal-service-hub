from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.errors import DomainError, require
from app.models import AccessGrant, Comment, Document, DocumentVersion, Order, User, WorkflowTask
from app.schemas import CommentCreate, DocumentCreate, VersionCreate, WorkflowAction, WorkflowStart
from app.services.common import commit_event, new_id, notify, record_audit, stable_hash


def get_document(db: Session, user: User, document_id: str, lock: bool = False) -> Document:
    query = db.query(Document).filter(Document.id == document_id)
    if lock:
        query = query.with_for_update()
    document = query.first()
    require(document is not None, "文书不存在", 404, "not_found")
    if user.has_role("operator"):
        return document
    grant = db.query(AccessGrant).filter_by(document_id=document.id, user_id=user.id, can_view=True).first()
    require(grant is not None and grant.revoked_at is None, "您未获得此文书的访问授权", 403, "forbidden")
    return document


def can_edit(db: Session, user: User, document: Document) -> bool:
    if user.has_role("operator"):
        return False
    grant = db.query(AccessGrant).filter_by(document_id=document.id, user_id=user.id, can_edit=True).first()
    return bool(grant and grant.revoked_at is None)


def create(db: Session, user: User, payload: DocumentCreate, request_id: str = "") -> Document:
    order = db.get(Order, payload.order_id)
    require(order is not None and user.id in (order.client_id, order.lawyer_id), "无权关联此订单", 403, "forbidden")
    allowed_members = {user.id, order.client_id, order.lawyer_id}
    require(set(payload.members) <= allowed_members, "文书参与人必须属于当前订单", 422, "invalid_member")
    require(order.status in ("service", "pending_receipt", "completed"), "订单支付后才能创建文书，已关闭或售后中的订单不能新建文书", 409, "invalid_state")
    document = Document(id=new_id(), order_id=order.id, owner_id=user.id, title=payload.title, doc_type=payload.doc_type, members_json=list(dict.fromkeys([user.id, order.client_id, order.lawyer_id, *payload.members])))
    db.add(document)
    db.flush()
    version = DocumentVersion(id=new_id(), document_id=document.id, number=1, body=payload.body, body_hash=stable_hash(payload.body), author_id=user.id)
    db.add(version)
    for member in document.members_json:
        db.add(AccessGrant(id=new_id(), document_id=document.id, user_id=member, can_view=True, can_edit=member in (user.id, order.lawyer_id)))
    record_audit(db, user, "document.created", "document", document.id, {"order_id": order.id}, request_id)
    commit_event(db, "document.created", "document", document.id, {"order_id": order.id})
    db.flush()
    db.refresh(document)
    return document


def create_version(db: Session, user: User, document_id: str, payload: VersionCreate, request_id: str = "") -> DocumentVersion:
    document = get_document(db, user, document_id, lock=True)
    require(can_edit(db, user, document), "您没有编辑权限", 403, "forbidden")
    require(document.status in ("draft", "returned"), "当前文书已锁定或正在会签", 409, "invalid_state")
    require(payload.base_version == document.current_version, "文书版本已更新，请刷新后重试", 409, "version_conflict")
    version = DocumentVersion(id=new_id(), document_id=document.id, number=document.current_version + 1, body=payload.body, body_hash=stable_hash(payload.body), author_id=user.id)
    db.add(version)
    document.current_version += 1
    record_audit(db, user, "document.version.created", "document", document.id, {"version": version.number}, request_id)
    commit_event(db, "document.version.created", "document", document.id, {"version": version.number})
    db.flush()
    db.refresh(version)
    return version


def start_workflow(db: Session, user: User, document_id: str, payload: WorkflowStart, request_id: str = "") -> Document:
    document = get_document(db, user, document_id, lock=True)
    require(can_edit(db, user, document), "您没有发起会签权限", 403, "forbidden")
    require(document.status in ("draft", "returned"), "当前文书不可发起会签", 409, "invalid_state")
    require(len(set(payload.assignee_ids)) == len(payload.assignee_ids), "会签人不能重复", 422, "invalid_assignee")
    require(not db.query(WorkflowTask).filter_by(document_id=document.id, version_number=document.current_version).first(), "本版本已有流转记录，请保存新版本后重新发起", 409, "workflow_conflict")
    require(all(member in document.members_json for member in payload.assignee_ids), "会签人必须是文书参与人", 422, "invalid_assignee")
    for member in payload.assignee_ids:
        grant = db.query(AccessGrant).filter_by(document_id=document.id, user_id=member, can_view=True).first()
        require(grant is not None and grant.revoked_at is None, "会签人授权已失效", 422, "invalid_assignee")
    document.status = "signing"
    document.locked_version = document.current_version
    for index, assignee in enumerate(payload.assignee_ids, start=1):
        db.add(WorkflowTask(id=new_id(), document_id=document.id, version_number=document.current_version, sequence=index, assignee_id=assignee, status="pending" if index == 1 else "waiting"))
    notify(db, payload.assignee_ids[0], "文书待处理", f"文书“{document.title}”等待您确认", "document", document.id)
    record_audit(db, user, "workflow.started", "document", document.id, {"version": document.current_version}, request_id)
    commit_event(db, "workflow.started", "document", document.id, {"version": document.current_version})
    db.flush()
    db.refresh(document)
    return document


def act_on_workflow(db: Session, user: User, document_id: str, action: str, payload: WorkflowAction, request_id: str = "") -> Document:
    document = get_document(db, user, document_id, lock=True)
    require(document.status == "signing", "文书当前不在会签中", 409, "invalid_state")
    require(document.locked_version == payload.version, "只能处理当前锁定版本", 409, "version_conflict")
    task = db.query(WorkflowTask).filter_by(document_id=document.id, version_number=payload.version, assignee_id=user.id, status="pending").with_for_update().first()
    require(task is not None, "当前不是您的处理节点或任务已完成", 409, "workflow_conflict")
    if action == "return":
        require(payload.reason.strip(), "退回必须填写原因", 422, "reason_required")
        task.status = "returned"
        task.reason = payload.reason
        document.status = "returned"
        notify(db, document.owner_id, "文书已退回", payload.reason, "document", document.id)
        event = "workflow.returned"
    else:
        task.status = "confirmed"
        next_task = db.query(WorkflowTask).filter_by(document_id=document.id, version_number=payload.version, sequence=task.sequence + 1).first()
        if next_task:
            next_task.status = "pending"
            notify(db, next_task.assignee_id, "文书待处理", f"文书“{document.title}”等待您确认", "document", document.id)
        else:
            document.status = "confirmed"
            notify(db, document.owner_id, "文书会签完成", f"文书“{document.title}”已完成会签", "document", document.id)
        event = "workflow.confirmed"
    record_audit(db, user, event, "document", document.id, {"version": payload.version, "reason": payload.reason}, request_id)
    commit_event(db, event, "document", document.id, {"version": payload.version, "user_id": user.id})
    db.flush()
    db.refresh(document)
    return document


def add_comment(db: Session, user: User, document_id: str, payload: CommentCreate, request_id: str = "") -> Comment:
    document = get_document(db, user, document_id)
    require(not user.has_role("operator") or user.id in document.members_json, "运营人员不能批注文书", 403, "forbidden")
    require(payload.version <= document.current_version, "版本不存在", 422, "invalid_version")
    comment = Comment(id=new_id(), document_id=document.id, version_number=payload.version, author_id=user.id, text=payload.text)
    db.add(comment)
    record_audit(db, user, "document.comment.created", "comment", comment.id, {"document_id": document.id}, request_id)
    db.flush()
    db.refresh(comment)
    return comment


def revoke_access(db: Session, user: User, document_id: str, member_id: str, request_id: str = "") -> AccessGrant:
    document = get_document(db, user, document_id, lock=True)
    require(user.id == document.owner_id, "只有文书所有者可以撤销授权", 403, "forbidden")
    grant = db.query(AccessGrant).filter_by(document_id=document.id, user_id=member_id).first()
    require(grant is not None, "授权不存在", 404, "not_found")
    require(member_id != user.id, "不能撤销自己的访问权限", 422, "invalid_member")
    grant.revoked_at = datetime.now(timezone.utc)
    record_audit(db, user, "document.access.revoked", "document", document.id, {"member_id": member_id}, request_id)
    db.flush()
    db.refresh(grant)
    return grant


def restore_version(db: Session, user: User, document_id: str, number: int, request_id: str = "") -> DocumentVersion:
    document = get_document(db, user, document_id, lock=True)
    require(can_edit(db, user, document), "您没有编辑权限", 403, "forbidden")
    require(document.status in ("draft", "returned"), "当前文书已锁定或正在会签", 409, "invalid_state")
    source = db.query(DocumentVersion).filter_by(document_id=document.id, number=number).first()
    require(source is not None, "版本不存在", 404, "not_found")
    require(number != document.current_version, "该版本已是当前版本", 409, "invalid_version")
    version = DocumentVersion(id=new_id(), document_id=document.id, number=document.current_version + 1, body=source.body, body_hash=source.body_hash, author_id=user.id)
    db.add(version)
    document.current_version += 1
    record_audit(db, user, "document.version.restored", "document", document.id, {"from": number, "version": version.number}, request_id)
    db.flush()
    db.refresh(version)
    return version


def resolve_comment(db: Session, user: User, document_id: str, comment_id: str, request_id: str = "") -> Comment:
    document = get_document(db, user, document_id)
    comment = db.query(Comment).filter_by(id=comment_id, document_id=document.id).first()
    require(comment is not None, "批注不存在", 404, "not_found")
    require(user.id in (comment.author_id, document.owner_id), "只有批注作者或文书发起人可以标记解决", 403, "forbidden")
    comment.resolved = True
    record_audit(db, user, "document.comment.resolved", "comment", comment.id, {"document_id": document.id}, request_id)
    db.flush()
    return comment


def withdraw_workflow(db: Session, user: User, document_id: str, request_id: str = "") -> Document:
    document = get_document(db, user, document_id, lock=True)
    require(user.id == document.owner_id, "只有文书发起人可以撤回会签", 403, "forbidden")
    require(document.status == "signing", "文书当前不在会签中", 409, "invalid_state")
    for task in db.query(WorkflowTask).filter(WorkflowTask.document_id == document.id, WorkflowTask.version_number == document.locked_version, WorkflowTask.status.in_(["pending", "waiting"])).all():
        task.status = "withdrawn"
        if task.assignee_id != user.id:
            notify(db, task.assignee_id, "会签已撤回", f"文书“{document.title}”的会签已被发起人撤回", "document", document.id)
    document.status = "returned"
    record_audit(db, user, "workflow.withdrawn", "document", document.id, {"version": document.locked_version}, request_id)
    db.flush()
    db.refresh(document)
    return document
