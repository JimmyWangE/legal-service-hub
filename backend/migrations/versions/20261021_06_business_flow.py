from alembic import op
import sqlalchemy as sa


revision = "20261021_06"
down_revision = "20261020_05"
branch_labels = None
depends_on = None

NEW_COLUMNS = {
    "orders": [
        sa.Column("deliverables", sa.Text(), nullable=False, server_default=""),
        sa.Column("days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("payment_terms", sa.Text(), nullable=False, server_default=""),
        sa.Column("client_confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lawyer_confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_reason", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    ],
    "quotes": [sa.Column("payment_terms", sa.Text(), nullable=False, server_default="")],
    "consultations": [
        sa.Column("category", sa.String(length=20), nullable=False, server_default="unsure"),
        sa.Column("intake_json", sa.JSON(), nullable=True),
    ],
    "after_sales_cases": [
        sa.Column("resolved_by", sa.String(length=36), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
    ],
}


def upgrade():
    inspector = sa.inspect(op.get_bind())
    for table, columns in NEW_COLUMNS.items():
        existing = {column["name"] for column in inspector.get_columns(table)}
        for column in columns:
            if column.name not in existing:
                op.add_column(table, column)
    # 取消后的订单不再占用需求，需求可重新报价下单
    indexes = {index["name"] for index in inspector.get_indexes("orders")}
    if "ix_orders_request_id" in indexes:
        op.drop_index("ix_orders_request_id", table_name="orders")
    op.create_index("ix_orders_request_id", "orders", ["request_id"], unique=False)
    if "uq_active_request_order" not in indexes:
        op.create_index("uq_active_request_order", "orders", ["request_id"], unique=True, postgresql_where=sa.text("status <> 'cancelled'"), sqlite_where=sa.text("status <> 'cancelled'"))
    if "order_reviews" not in inspector.get_table_names():
        op.create_table(
            "order_reviews",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("order_id", sa.String(length=36), nullable=False),
            sa.Column("author_id", sa.String(length=36), nullable=False),
            sa.Column("target_id", sa.String(length=36), nullable=False),
            sa.Column("rating", sa.Integer(), nullable=False),
            sa.Column("content", sa.String(length=1000), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["order_id"], ["orders.id"]),
            sa.ForeignKeyConstraint(["author_id"], ["users.id"]),
            sa.ForeignKeyConstraint(["target_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("order_id", "author_id", name="uq_order_review_author"),
        )
        op.create_index("ix_order_reviews_order_id", "order_reviews", ["order_id"], unique=False)
        op.create_index("ix_order_reviews_target_id", "order_reviews", ["target_id"], unique=False)


def downgrade():
    op.drop_index("ix_order_reviews_target_id", table_name="order_reviews")
    op.drop_index("ix_order_reviews_order_id", table_name="order_reviews")
    op.drop_table("order_reviews")
    op.drop_index("uq_active_request_order", table_name="orders")
    op.drop_index("ix_orders_request_id", table_name="orders")
    op.create_index("ix_orders_request_id", "orders", ["request_id"], unique=True)
    for table, columns in NEW_COLUMNS.items():
        for column in columns:
            op.drop_column(table, column.name)
