import sqlalchemy as sa
from alembic import op


revision = "20261027_07"
down_revision = "20261021_06"
branch_labels = None
depends_on = None


def upgrade():
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("service_requests")}
    if "attachments_json" not in columns:
        op.add_column("service_requests", sa.Column("attachments_json", sa.JSON(), nullable=False, server_default="[]"))


def downgrade():
    op.drop_column("service_requests", "attachments_json")
