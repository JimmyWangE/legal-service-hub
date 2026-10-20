from alembic import op
import sqlalchemy as sa


revision = "20261020_05"
down_revision = "20261020_04"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    if "attachment_json" not in {column["name"] for column in sa.inspect(connection).get_columns("chat_messages")}:
        op.add_column("chat_messages", sa.Column("attachment_json", sa.JSON(), nullable=True))


def downgrade():
    op.drop_column("chat_messages", "attachment_json")
