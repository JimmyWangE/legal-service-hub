from alembic import op
import sqlalchemy as sa

revision = "20261016_02"
down_revision = "20261016_01"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    tables = set(sa.inspect(connection).get_table_names())
    additions = {
        "after_sales_cases": [sa.Column("previous_order_status", sa.String(30), nullable=False, server_default="service"), sa.Column("previous_settlement_status", sa.String(30), nullable=False, server_default="frozen")],
        "users": [sa.Column("email_verified", sa.Boolean(), nullable=False, server_default=sa.false()), sa.Column("token_version", sa.Integer(), nullable=False, server_default="0")],
        "lawyer_profiles": [sa.Column("approved_application_id", sa.String(36), nullable=True)],
        "consultations": [sa.Column("version", sa.Integer(), nullable=False, server_default="0")],
        "consultation_messages": [sa.Column("sequence", sa.Integer(), nullable=False, server_default="0"), sa.Column("source", sa.String(30), nullable=False, server_default="legacy")],
        "consents": [sa.Column("snapshot_json", sa.JSON(), nullable=False, server_default="{}")],
        "service_requests": [sa.Column("consent_id", sa.String(36), nullable=True)],
        "payments": [sa.Column("merchant_id", sa.String(100), nullable=False, server_default=""), sa.Column("transaction_id", sa.String(150), nullable=True), sa.Column("client_params", sa.JSON(), nullable=False, server_default="{}"), sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True), sa.Column("refunded", sa.Numeric(12,2), nullable=False, server_default="0"), sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"), sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now())],
    }
    for table, columns in additions.items():
        present = {column["name"] for column in sa.inspect(connection).get_columns(table)}
        for column in columns:
            if column.name not in present:
                if table == "payments" and column.name == "next_attempt_at" and connection.dialect.name == "sqlite":
                    column.server_default = sa.DefaultClause(sa.text("'1970-01-01 00:00:00'"))
                op.add_column(table, column)
    if "health_probes" not in tables:
        op.create_table('health_probes',
            sa.Column('id', sa.String(length=36), nullable=False),
            sa.Column('value', sa.String(length=100), nullable=False),
            sa.PrimaryKeyConstraint('id')
            )
    if "payment_webhook_inbox" not in tables:
        op.create_table('payment_webhook_inbox',
            sa.Column('id', sa.String(length=36), nullable=False),
            sa.Column('provider', sa.String(length=40), nullable=False),
            sa.Column('merchant_id', sa.String(length=100), nullable=False),
            sa.Column('event_id', sa.String(length=150), nullable=False),
            sa.Column('body_hash', sa.String(length=64), nullable=False),
            sa.Column('event_json', sa.JSON(), nullable=False),
            sa.Column('status', sa.String(length=30), nullable=False),
            sa.Column('attempts', sa.Integer(), nullable=False),
            sa.Column('error_code', sa.String(length=80), nullable=False),
            sa.Column('next_attempt_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('processed_at', sa.DateTime(timezone=True), nullable=True),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('provider', 'merchant_id', 'event_id', name='uq_payment_inbox_event')
            )
    if "email_verifications" not in tables:
        op.create_table('email_verifications',
            sa.Column('id', sa.String(length=36), nullable=False),
            sa.Column('user_id', sa.String(length=36), nullable=False),
            sa.Column('token_hash', sa.String(length=64), nullable=False),
            sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('token_hash')
            )
    if "lawyer_applications" not in tables:
        op.create_table('lawyer_applications',
            sa.Column('id', sa.String(length=36), nullable=False),
            sa.Column('user_id', sa.String(length=36), nullable=False),
            sa.Column('version', sa.Integer(), nullable=False),
            sa.Column('firm', sa.String(length=200), nullable=False),
            sa.Column('region', sa.String(length=100), nullable=False),
            sa.Column('field', sa.String(length=100), nullable=False),
            sa.Column('mode', sa.String(length=100), nullable=False),
            sa.Column('license_number', sa.String(length=120), nullable=False),
            sa.Column('expires_on', sa.Date(), nullable=False),
            sa.Column('credential_file_ids', sa.JSON(), nullable=False),
            sa.Column('status', sa.String(length=30), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('user_id', 'version', name='uq_lawyer_application_version')
            )
    if "user_roles" not in tables:
        op.create_table('user_roles',
            sa.Column('user_id', sa.String(length=36), nullable=False),
            sa.Column('role', sa.String(length=30), nullable=False),
            sa.Column('source', sa.String(length=100), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
            sa.PrimaryKeyConstraint('user_id', 'role')
            )
    if "lawyer_reviews" not in tables:
        op.create_table('lawyer_reviews',
            sa.Column('id', sa.String(length=36), nullable=False),
            sa.Column('application_id', sa.String(length=36), nullable=False),
            sa.Column('reviewer_id', sa.String(length=36), nullable=False),
            sa.Column('version', sa.Integer(), nullable=False),
            sa.Column('decision', sa.String(length=30), nullable=False),
            sa.Column('reason', sa.Text(), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(['application_id'], ['lawyer_applications.id'], ),
            sa.ForeignKeyConstraint(['reviewer_id'], ['users.id'], ),
            sa.PrimaryKeyConstraint('id')
            )
    if "payment_transactions" not in tables:
        op.create_table('payment_transactions',
            sa.Column('id', sa.String(length=36), nullable=False),
            sa.Column('payment_id', sa.String(length=36), nullable=False),
            sa.Column('provider', sa.String(length=40), nullable=False),
            sa.Column('merchant_id', sa.String(length=100), nullable=False),
            sa.Column('transaction_id', sa.String(length=150), nullable=False),
            sa.Column('amount', sa.Numeric(precision=12, scale=2), nullable=False),
            sa.Column('status', sa.String(length=30), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(['payment_id'], ['payments.id'], ),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('provider', 'merchant_id', 'transaction_id', name='uq_payment_transaction')
            )
    if "refunds" not in tables:
        op.create_table('refunds',
            sa.Column('id', sa.String(length=36), nullable=False),
            sa.Column('payment_id', sa.String(length=36), nullable=False),
            sa.Column('case_id', sa.String(length=36), nullable=True),
            sa.Column('amount', sa.Numeric(precision=12, scale=2), nullable=False),
            sa.Column('status', sa.String(length=30), nullable=False),
            sa.Column('provider_refund_id', sa.String(length=150), nullable=False),
            sa.Column('attempts', sa.Integer(), nullable=False),
            sa.Column('next_attempt_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(['case_id'], ['after_sales_cases.id'], ),
            sa.ForeignKeyConstraint(['payment_id'], ['payments.id'], ),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('case_id')
            )
    connection.execute(sa.text("WITH ranked AS (SELECT id, ROW_NUMBER() OVER (PARTITION BY consultation_id ORDER BY created_at, id) AS number FROM consultation_messages) UPDATE consultation_messages SET sequence = (SELECT number FROM ranked WHERE ranked.id = consultation_messages.id) WHERE sequence = 0"))
    connection.execute(sa.text("UPDATE consultations SET version = COALESCE((SELECT MAX(sequence) FROM consultation_messages WHERE consultation_id = consultations.id), 0)"))
    indexes = {index["name"] for index in sa.inspect(connection).get_indexes("consultation_messages")}
    constraints = {item["name"] for item in sa.inspect(connection).get_unique_constraints("consultation_messages")}
    if "uq_consultation_sequence" not in indexes | constraints:
        op.create_index("uq_consultation_sequence", "consultation_messages", ["consultation_id", "sequence"], unique=True)
    connection.execute(sa.text("INSERT INTO user_roles (user_id, role, source, created_at) SELECT id, CASE WHEN role = 'operator' THEN 'operator' ELSE 'client' END, 'legacy_backfill', CURRENT_TIMESTAMP FROM users WHERE NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = users.id)"))
    connection.execute(sa.text("UPDATE lawyer_profiles SET status = 'frozen', available = false WHERE status = 'approved' AND approved_application_id IS NULL"))
    connection.execute(sa.text("UPDATE users SET is_active = false WHERE (id = 'C1' AND email = 'client@example.com') OR (id = 'L1' AND email = 'lawyer@example.com') OR (id = 'A1' AND email = 'operator@example.com')"))

    if "ix_audit_logs_action" not in {item["name"] for item in sa.inspect(connection).get_indexes("audit_logs")}:
        op.create_index(op.f('ix_audit_logs_action'), 'audit_logs', ['action'], unique=False)
    if "ix_audit_logs_actor_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("audit_logs")}:
        op.create_index(op.f('ix_audit_logs_actor_id'), 'audit_logs', ['actor_id'], unique=False)
    if "ix_audit_logs_created_at" not in {item["name"] for item in sa.inspect(connection).get_indexes("audit_logs")}:
        op.create_index(op.f('ix_audit_logs_created_at'), 'audit_logs', ['created_at'], unique=False)
    if "ix_audit_logs_object_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("audit_logs")}:
        op.create_index(op.f('ix_audit_logs_object_id'), 'audit_logs', ['object_id'], unique=False)
    if "ix_outbox_events_aggregate_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("outbox_events")}:
        op.create_index(op.f('ix_outbox_events_aggregate_id'), 'outbox_events', ['aggregate_id'], unique=False)
    if "ix_outbox_events_created_at" not in {item["name"] for item in sa.inspect(connection).get_indexes("outbox_events")}:
        op.create_index(op.f('ix_outbox_events_created_at'), 'outbox_events', ['created_at'], unique=False)
    if "ix_outbox_events_event_type" not in {item["name"] for item in sa.inspect(connection).get_indexes("outbox_events")}:
        op.create_index(op.f('ix_outbox_events_event_type'), 'outbox_events', ['event_type'], unique=False)
    if "ix_payment_webhook_inbox_next_attempt_at" not in {item["name"] for item in sa.inspect(connection).get_indexes("payment_webhook_inbox")}:
        op.create_index(op.f('ix_payment_webhook_inbox_next_attempt_at'), 'payment_webhook_inbox', ['next_attempt_at'], unique=False)
    if "ix_payment_webhook_inbox_status" not in {item["name"] for item in sa.inspect(connection).get_indexes("payment_webhook_inbox")}:
        op.create_index(op.f('ix_payment_webhook_inbox_status'), 'payment_webhook_inbox', ['status'], unique=False)
    if "ix_users_email" not in {item["name"] for item in sa.inspect(connection).get_indexes("users")}:
        op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)
    if "ix_users_org_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("users")}:
        op.create_index(op.f('ix_users_org_id'), 'users', ['org_id'], unique=False)
    if "ix_users_role" not in {item["name"] for item in sa.inspect(connection).get_indexes("users")}:
        op.create_index(op.f('ix_users_role'), 'users', ['role'], unique=False)
    if "ix_consents_owner_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("consents")}:
        op.create_index(op.f('ix_consents_owner_id'), 'consents', ['owner_id'], unique=False)
    if "ix_consents_source_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("consents")}:
        op.create_index(op.f('ix_consents_source_id'), 'consents', ['source_id'], unique=False)
    if "ix_consultations_owner_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("consultations")}:
        op.create_index(op.f('ix_consultations_owner_id'), 'consultations', ['owner_id'], unique=False)
    if "ix_email_verifications_user_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("email_verifications")}:
        op.create_index(op.f('ix_email_verifications_user_id'), 'email_verifications', ['user_id'], unique=False)
    if "ix_idempotency_records_actor_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("idempotency_records")}:
        op.create_index(op.f('ix_idempotency_records_actor_id'), 'idempotency_records', ['actor_id'], unique=False)
    if "ix_lawyer_applications_status" not in {item["name"] for item in sa.inspect(connection).get_indexes("lawyer_applications")}:
        op.create_index(op.f('ix_lawyer_applications_status'), 'lawyer_applications', ['status'], unique=False)
    if "ix_lawyer_applications_user_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("lawyer_applications")}:
        op.create_index(op.f('ix_lawyer_applications_user_id'), 'lawyer_applications', ['user_id'], unique=False)
    if "uq_lawyer_active_application" not in {item["name"] for item in sa.inspect(connection).get_indexes("lawyer_applications")}:
        op.create_index('uq_lawyer_active_application', 'lawyer_applications', ['user_id'], unique=True, postgresql_where=sa.text("status IN ('submitted','under_review','draft')"), sqlite_where=sa.text("status IN ('submitted','under_review','draft')"))
    if "ix_lawyer_profiles_available" not in {item["name"] for item in sa.inspect(connection).get_indexes("lawyer_profiles")}:
        op.create_index(op.f('ix_lawyer_profiles_available'), 'lawyer_profiles', ['available'], unique=False)
    if "ix_lawyer_profiles_status" not in {item["name"] for item in sa.inspect(connection).get_indexes("lawyer_profiles")}:
        op.create_index(op.f('ix_lawyer_profiles_status'), 'lawyer_profiles', ['status'], unique=False)
    if "uq_approved_lawyer_license" not in {item["name"] for item in sa.inspect(connection).get_indexes("lawyer_profiles")}:
        op.create_index('uq_approved_lawyer_license', 'lawyer_profiles', ['license_number'], unique=True, postgresql_where=sa.text("status = 'approved' AND license_number <> ''"), sqlite_where=sa.text("status = 'approved' AND license_number <> ''"))
    if "ix_notifications_created_at" not in {item["name"] for item in sa.inspect(connection).get_indexes("notifications")}:
        op.create_index(op.f('ix_notifications_created_at'), 'notifications', ['created_at'], unique=False)
    if "ix_notifications_user_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("notifications")}:
        op.create_index(op.f('ix_notifications_user_id'), 'notifications', ['user_id'], unique=False)
    if "ix_stored_files_document_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("stored_files")}:
        op.create_index(op.f('ix_stored_files_document_id'), 'stored_files', ['document_id'], unique=False)
    if "ix_stored_files_owner_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("stored_files")}:
        op.create_index(op.f('ix_stored_files_owner_id'), 'stored_files', ['owner_id'], unique=False)
    if "ix_stored_files_sha256" not in {item["name"] for item in sa.inspect(connection).get_indexes("stored_files")}:
        op.create_index(op.f('ix_stored_files_sha256'), 'stored_files', ['sha256'], unique=False)
    if "ix_stored_files_status" not in {item["name"] for item in sa.inspect(connection).get_indexes("stored_files")}:
        op.create_index(op.f('ix_stored_files_status'), 'stored_files', ['status'], unique=False)
    if "ix_consultation_messages_consultation_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("consultation_messages")}:
        op.create_index(op.f('ix_consultation_messages_consultation_id'), 'consultation_messages', ['consultation_id'], unique=False)
    if "ix_lawyer_reviews_application_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("lawyer_reviews")}:
        op.create_index(op.f('ix_lawyer_reviews_application_id'), 'lawyer_reviews', ['application_id'], unique=False)
    if "ix_service_requests_owner_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("service_requests")}:
        op.create_index(op.f('ix_service_requests_owner_id'), 'service_requests', ['owner_id'], unique=False)
    if "ix_service_requests_source_consultation_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("service_requests")}:
        op.create_index(op.f('ix_service_requests_source_consultation_id'), 'service_requests', ['source_consultation_id'], unique=False)
    if "ix_service_requests_status" not in {item["name"] for item in sa.inspect(connection).get_indexes("service_requests")}:
        op.create_index(op.f('ix_service_requests_status'), 'service_requests', ['status'], unique=False)
    if "ix_consultation_feedback_consultation_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("consultation_feedback")}:
        op.create_index(op.f('ix_consultation_feedback_consultation_id'), 'consultation_feedback', ['consultation_id'], unique=False)
    if "ix_consultation_feedback_message_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("consultation_feedback")}:
        op.create_index(op.f('ix_consultation_feedback_message_id'), 'consultation_feedback', ['message_id'], unique=False)
    if "ix_consultation_feedback_user_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("consultation_feedback")}:
        op.create_index(op.f('ix_consultation_feedback_user_id'), 'consultation_feedback', ['user_id'], unique=False)
    if "ix_quotes_lawyer_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("quotes")}:
        op.create_index(op.f('ix_quotes_lawyer_id'), 'quotes', ['lawyer_id'], unique=False)
    if "ix_quotes_request_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("quotes")}:
        op.create_index(op.f('ix_quotes_request_id'), 'quotes', ['request_id'], unique=False)
    if "ix_quotes_status" not in {item["name"] for item in sa.inspect(connection).get_indexes("quotes")}:
        op.create_index(op.f('ix_quotes_status'), 'quotes', ['status'], unique=False)
    if "uq_active_lawyer_quote" not in {item["name"] for item in sa.inspect(connection).get_indexes("quotes")}:
        op.create_index('uq_active_lawyer_quote', 'quotes', ['request_id', 'lawyer_id'], unique=True, postgresql_where=sa.text("status = 'valid'"), sqlite_where=sa.text("status = 'valid'"))
    if "ix_orders_client_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("orders")}:
        op.create_index(op.f('ix_orders_client_id'), 'orders', ['client_id'], unique=False)
    if "ix_orders_lawyer_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("orders")}:
        op.create_index(op.f('ix_orders_lawyer_id'), 'orders', ['lawyer_id'], unique=False)
    if "ix_orders_request_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("orders")}:
        op.create_index(op.f('ix_orders_request_id'), 'orders', ['request_id'], unique=True)
    if "ix_orders_status" not in {item["name"] for item in sa.inspect(connection).get_indexes("orders")}:
        op.create_index(op.f('ix_orders_status'), 'orders', ['status'], unique=False)
    if "ix_after_sales_cases_order_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("after_sales_cases")}:
        op.create_index(op.f('ix_after_sales_cases_order_id'), 'after_sales_cases', ['order_id'], unique=False)
    if "ix_after_sales_cases_status" not in {item["name"] for item in sa.inspect(connection).get_indexes("after_sales_cases")}:
        op.create_index(op.f('ix_after_sales_cases_status'), 'after_sales_cases', ['status'], unique=False)
    if "ix_documents_order_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("documents")}:
        op.create_index(op.f('ix_documents_order_id'), 'documents', ['order_id'], unique=False)
    if "ix_documents_owner_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("documents")}:
        op.create_index(op.f('ix_documents_owner_id'), 'documents', ['owner_id'], unique=False)
    if "ix_documents_status" not in {item["name"] for item in sa.inspect(connection).get_indexes("documents")}:
        op.create_index(op.f('ix_documents_status'), 'documents', ['status'], unique=False)
    if "ix_payments_next_attempt_at" not in {item["name"] for item in sa.inspect(connection).get_indexes("payments")}:
        op.create_index(op.f('ix_payments_next_attempt_at'), 'payments', ['next_attempt_at'], unique=False)
    if "ix_payments_order_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("payments")}:
        op.create_index(op.f('ix_payments_order_id'), 'payments', ['order_id'], unique=False)
    if "ix_payments_status" not in {item["name"] for item in sa.inspect(connection).get_indexes("payments")}:
        op.create_index(op.f('ix_payments_status'), 'payments', ['status'], unique=False)
    if "uq_active_payment_order" not in {item["name"] for item in sa.inspect(connection).get_indexes("payments")}:
        op.create_index('uq_active_payment_order', 'payments', ['order_id'], unique=True, postgresql_where=sa.text("status IN ('creating','created','pending')"), sqlite_where=sa.text("status IN ('creating','created','pending')"))
    if "ix_deliveries_order_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("deliveries")}:
        op.create_index(op.f('ix_deliveries_order_id'), 'deliveries', ['order_id'], unique=False)
    if "ix_document_access_grants_document_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("document_access_grants")}:
        op.create_index(op.f('ix_document_access_grants_document_id'), 'document_access_grants', ['document_id'], unique=False)
    if "ix_document_access_grants_user_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("document_access_grants")}:
        op.create_index(op.f('ix_document_access_grants_user_id'), 'document_access_grants', ['user_id'], unique=False)
    if "ix_document_comments_document_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("document_comments")}:
        op.create_index(op.f('ix_document_comments_document_id'), 'document_comments', ['document_id'], unique=False)
    if "ix_document_versions_document_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("document_versions")}:
        op.create_index(op.f('ix_document_versions_document_id'), 'document_versions', ['document_id'], unique=False)
    if "ix_payment_transactions_payment_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("payment_transactions")}:
        op.create_index(op.f('ix_payment_transactions_payment_id'), 'payment_transactions', ['payment_id'], unique=False)
    if "ix_refunds_payment_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("refunds")}:
        op.create_index(op.f('ix_refunds_payment_id'), 'refunds', ['payment_id'], unique=False)
    if "ix_refunds_status" not in {item["name"] for item in sa.inspect(connection).get_indexes("refunds")}:
        op.create_index(op.f('ix_refunds_status'), 'refunds', ['status'], unique=False)
    if "ix_workflow_tasks_assignee_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("workflow_tasks")}:
        op.create_index(op.f('ix_workflow_tasks_assignee_id'), 'workflow_tasks', ['assignee_id'], unique=False)
    if "ix_workflow_tasks_document_id" not in {item["name"] for item in sa.inspect(connection).get_indexes("workflow_tasks")}:
        op.create_index(op.f('ix_workflow_tasks_document_id'), 'workflow_tasks', ['document_id'], unique=False)
    if "ix_workflow_tasks_status" not in {item["name"] for item in sa.inspect(connection).get_indexes("workflow_tasks")}:
        op.create_index(op.f('ix_workflow_tasks_status'), 'workflow_tasks', ['status'], unique=False)


def downgrade():
    raise RuntimeError("资金及授权数据迁移禁止自动删表回退；请恢复经验证的备份或执行前向修复")
