from alembic import op
import sqlalchemy as sa


revision = "20261019_03"
down_revision = "20261016_02"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    if "registration_challenges" in set(sa.inspect(connection).get_table_names()):
        return
    op.create_table(
        "registration_challenges",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("question", sa.String(length=100), nullable=False),
        sa.Column("answer_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_registration_challenges_expires_at"), "registration_challenges", ["expires_at"], unique=False)


def downgrade():
    op.drop_index(op.f("ix_registration_challenges_expires_at"), table_name="registration_challenges")
    op.drop_table("registration_challenges")
