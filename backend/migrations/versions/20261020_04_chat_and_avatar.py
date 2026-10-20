from alembic import op
import sqlalchemy as sa


revision = "20261020_04"
down_revision = "20261019_03"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    if "avatar_data" not in {column["name"] for column in sa.inspect(connection).get_columns("users")}:
        op.add_column("users", sa.Column("avatar_data", sa.Text(), nullable=True))
    tables = set(sa.inspect(connection).get_table_names())
    if "chat_conversations" not in tables:
        op.create_table(
            "chat_conversations",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("client_id", sa.String(length=36), nullable=False),
            sa.Column("lawyer_id", sa.String(length=36), nullable=False),
            sa.Column("order_id", sa.String(length=36), nullable=True),
            sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("client_read_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("lawyer_read_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["client_id"], ["users.id"]),
            sa.ForeignKeyConstraint(["lawyer_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("client_id", "lawyer_id", name="uq_chat_pair"),
        )
        op.create_index(op.f("ix_chat_conversations_client_id"), "chat_conversations", ["client_id"], unique=False)
        op.create_index(op.f("ix_chat_conversations_lawyer_id"), "chat_conversations", ["lawyer_id"], unique=False)
        op.create_index(op.f("ix_chat_conversations_last_message_at"), "chat_conversations", ["last_message_at"], unique=False)
    if "chat_messages" not in tables:
        op.create_table(
            "chat_messages",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("conversation_id", sa.String(length=36), nullable=False),
            sa.Column("sender_id", sa.String(length=36), nullable=False),
            sa.Column("text", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["conversation_id"], ["chat_conversations.id"]),
            sa.ForeignKeyConstraint(["sender_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_chat_messages_conversation_id"), "chat_messages", ["conversation_id"], unique=False)
        op.create_index("ix_chat_messages_conversation_created", "chat_messages", ["conversation_id", "created_at"], unique=False)


def downgrade():
    op.drop_index("ix_chat_messages_conversation_created", table_name="chat_messages")
    op.drop_index(op.f("ix_chat_messages_conversation_id"), table_name="chat_messages")
    op.drop_table("chat_messages")
    op.drop_index(op.f("ix_chat_conversations_last_message_at"), table_name="chat_conversations")
    op.drop_index(op.f("ix_chat_conversations_lawyer_id"), table_name="chat_conversations")
    op.drop_index(op.f("ix_chat_conversations_client_id"), table_name="chat_conversations")
    op.drop_table("chat_conversations")
    op.drop_column("users", "avatar_data")
