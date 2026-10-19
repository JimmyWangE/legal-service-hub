from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import hash_password
from app.models import LawyerProfile, User, UserRole


def seed_demo_data(db: Session) -> None:
    settings = get_settings()
    if not settings.seed_demo_data or db.query(User).count():
        return
    client = User(id="C1", email="client@example.com", name="陈先生", role="client", password_hash=hash_password("client-demo-123"))
    lawyer = User(id="L1", email="lawyer@example.com", name="林律师", role="lawyer", password_hash=hash_password("lawyer-demo-123"))
    operator = User(id="A1", email="operator@example.com", name="运营审核员", role="operator", password_hash=hash_password("operator-demo-123"))
    for user in (client, lawyer, operator):
        user.email_verified = True
        user.role_grants = [UserRole(role=user.role, source="test_demo")]
        if user.role == "lawyer":
            user.role_grants.append(UserRole(role="client", source="test_demo"))
    db.add_all([client, lawyer, operator])
    db.flush()
    db.add(LawyerProfile(user_id=lawyer.id, firm="和信律师事务所", region="北京", field="合同纠纷", mode="线上服务", license_number="DEMO-LICENSE-1028", expires_on=date.today() + timedelta(days=365), status="approved", available=True))
    db.commit()
