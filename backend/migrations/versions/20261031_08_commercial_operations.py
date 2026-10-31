import sqlalchemy as sa
from alembic import op


revision = "20261031_08"
down_revision = "20261027_07"
branch_labels = None
depends_on = None

NEW_COLUMNS = {
    "orders": [
        sa.Column("service_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("settled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("platform_fee", sa.Numeric(12, 2), nullable=False, server_default="0"),
    ],
    "lawyer_profiles": [
        sa.Column("bio", sa.Text(), nullable=False, server_default=""),
        sa.Column("practice_years", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("specialties", sa.JSON(), nullable=False, server_default="[]"),
    ],
    "service_requests": [sa.Column("service_id", sa.String(length=36), nullable=True)],
}


def upgrade():
    inspector = sa.inspect(op.get_bind())
    for table, columns in NEW_COLUMNS.items():
        existing = {column["name"] for column in inspector.get_columns(table)}
        for column in columns:
            if column.name not in existing:
                op.add_column(table, column)
    if "ix_service_requests_service_id" not in {index["name"] for index in inspector.get_indexes("service_requests")}:
        op.create_index("ix_service_requests_service_id", "service_requests", ["service_id"])
    if "lawyer_services" not in inspector.get_table_names():
        op.create_table(
            "lawyer_services",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("lawyer_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("title", sa.String(length=100), nullable=False),
            sa.Column("service_type", sa.String(length=100), nullable=False),
            sa.Column("field", sa.String(length=100), nullable=False),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("deliverables", sa.Text(), nullable=False),
            sa.Column("price", sa.Numeric(12, 2), nullable=False),
            sa.Column("days", sa.Integer(), nullable=False),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("sold", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_lawyer_services_lawyer_id", "lawyer_services", ["lawyer_id"])
        op.create_index("ix_lawyer_services_active", "lawyer_services", ["active"])


def downgrade():
    op.drop_table("lawyer_services")
    op.drop_index("ix_service_requests_service_id", table_name="service_requests")
    for table, columns in NEW_COLUMNS.items():
        for column in columns:
            op.drop_column(table, column.name)
