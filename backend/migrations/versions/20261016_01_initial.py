from alembic import op
import sqlalchemy as sa

revision = "20261016_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('audit_logs',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('actor_id', sa.String(length=36), nullable=True),
    sa.Column('action', sa.String(length=100), nullable=False),
    sa.Column('object_type', sa.String(length=60), nullable=False),
    sa.Column('object_id', sa.String(length=36), nullable=False),
    sa.Column('detail_json', sa.JSON(), nullable=False),
    sa.Column('request_id', sa.String(length=100), nullable=False),
    sa.Column('ip_address', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_audit_logs_action'), 'audit_logs', ['action'], unique=False)
    op.create_index(op.f('ix_audit_logs_actor_id'), 'audit_logs', ['actor_id'], unique=False)
    op.create_index(op.f('ix_audit_logs_created_at'), 'audit_logs', ['created_at'], unique=False)
    op.create_index(op.f('ix_audit_logs_object_id'), 'audit_logs', ['object_id'], unique=False)
    op.create_table('health_probes',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('value', sa.String(length=100), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('outbox_events',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('event_type', sa.String(length=100), nullable=False),
    sa.Column('aggregate_type', sa.String(length=60), nullable=False),
    sa.Column('aggregate_id', sa.String(length=36), nullable=False),
    sa.Column('payload_json', sa.JSON(), nullable=False),
    sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_outbox_events_aggregate_id'), 'outbox_events', ['aggregate_id'], unique=False)
    op.create_index(op.f('ix_outbox_events_created_at'), 'outbox_events', ['created_at'], unique=False)
    op.create_index(op.f('ix_outbox_events_event_type'), 'outbox_events', ['event_type'], unique=False)
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
    op.create_index(op.f('ix_payment_webhook_inbox_next_attempt_at'), 'payment_webhook_inbox', ['next_attempt_at'], unique=False)
    op.create_index(op.f('ix_payment_webhook_inbox_status'), 'payment_webhook_inbox', ['status'], unique=False)
    op.create_table('users',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('email', sa.String(length=255), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('role', sa.String(length=30), nullable=False),
    sa.Column('password_hash', sa.String(length=255), nullable=False),
    sa.Column('org_id', sa.String(length=36), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('email_verified', sa.Boolean(), nullable=False),
    sa.Column('token_version', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)
    op.create_index(op.f('ix_users_org_id'), 'users', ['org_id'], unique=False)
    op.create_index(op.f('ix_users_role'), 'users', ['role'], unique=False)
    op.create_table('consents',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('owner_id', sa.String(length=36), nullable=False),
    sa.Column('source_id', sa.String(length=36), nullable=False),
    sa.Column('scope', sa.String(length=100), nullable=False),
    sa.Column('snapshot_hash', sa.String(length=64), nullable=False),
    sa.Column('snapshot_json', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_consents_owner_id'), 'consents', ['owner_id'], unique=False)
    op.create_index(op.f('ix_consents_source_id'), 'consents', ['source_id'], unique=False)
    op.create_table('consultations',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('owner_id', sa.String(length=36), nullable=False),
    sa.Column('topic', sa.String(length=80), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('status', sa.String(length=30), nullable=False),
    sa.Column('risk_level', sa.String(length=20), nullable=False),
    sa.Column('summary_json', sa.JSON(), nullable=True),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_consultations_owner_id'), 'consultations', ['owner_id'], unique=False)
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
    op.create_index(op.f('ix_email_verifications_user_id'), 'email_verifications', ['user_id'], unique=False)
    op.create_table('idempotency_records',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('actor_id', sa.String(length=36), nullable=False),
    sa.Column('key', sa.String(length=180), nullable=False),
    sa.Column('request_hash', sa.String(length=64), nullable=False),
    sa.Column('status_code', sa.Integer(), nullable=False),
    sa.Column('response_json', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['actor_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('actor_id', 'key', name='uq_idempotency_actor_key')
    )
    op.create_index(op.f('ix_idempotency_records_actor_id'), 'idempotency_records', ['actor_id'], unique=False)
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
    op.create_index(op.f('ix_lawyer_applications_status'), 'lawyer_applications', ['status'], unique=False)
    op.create_index(op.f('ix_lawyer_applications_user_id'), 'lawyer_applications', ['user_id'], unique=False)
    op.create_index('uq_lawyer_active_application', 'lawyer_applications', ['user_id'], unique=True, postgresql_where=sa.text("status IN ('submitted','under_review','draft')"), sqlite_where=sa.text("status IN ('submitted','under_review','draft')"))
    op.create_table('lawyer_profiles',
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('firm', sa.String(length=200), nullable=False),
    sa.Column('region', sa.String(length=100), nullable=False),
    sa.Column('field', sa.String(length=100), nullable=False),
    sa.Column('mode', sa.String(length=100), nullable=False),
    sa.Column('license_number', sa.String(length=120), nullable=False),
    sa.Column('expires_on', sa.Date(), nullable=True),
    sa.Column('status', sa.String(length=30), nullable=False),
    sa.Column('available', sa.Boolean(), nullable=False),
    sa.Column('approved_application_id', sa.String(length=36), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('user_id')
    )
    op.create_index(op.f('ix_lawyer_profiles_available'), 'lawyer_profiles', ['available'], unique=False)
    op.create_index(op.f('ix_lawyer_profiles_status'), 'lawyer_profiles', ['status'], unique=False)
    op.create_index('uq_approved_lawyer_license', 'lawyer_profiles', ['license_number'], unique=True, postgresql_where=sa.text("status = 'approved' AND license_number <> ''"), sqlite_where=sa.text("status = 'approved' AND license_number <> ''"))
    op.create_table('notifications',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('body', sa.String(length=2000), nullable=False),
    sa.Column('object_type', sa.String(length=60), nullable=False),
    sa.Column('object_id', sa.String(length=36), nullable=False),
    sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_notifications_created_at'), 'notifications', ['created_at'], unique=False)
    op.create_index(op.f('ix_notifications_user_id'), 'notifications', ['user_id'], unique=False)
    op.create_table('stored_files',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('owner_id', sa.String(length=36), nullable=False),
    sa.Column('document_id', sa.String(length=36), nullable=True),
    sa.Column('original_name', sa.String(length=255), nullable=False),
    sa.Column('content_type', sa.String(length=150), nullable=False),
    sa.Column('size', sa.Integer(), nullable=False),
    sa.Column('sha256', sa.String(length=64), nullable=False),
    sa.Column('storage_path', sa.String(length=500), nullable=False),
    sa.Column('status', sa.String(length=30), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_stored_files_document_id'), 'stored_files', ['document_id'], unique=False)
    op.create_index(op.f('ix_stored_files_owner_id'), 'stored_files', ['owner_id'], unique=False)
    op.create_index(op.f('ix_stored_files_sha256'), 'stored_files', ['sha256'], unique=False)
    op.create_index(op.f('ix_stored_files_status'), 'stored_files', ['status'], unique=False)
    op.create_table('user_roles',
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('role', sa.String(length=30), nullable=False),
    sa.Column('source', sa.String(length=100), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('user_id', 'role')
    )
    op.create_table('consultation_messages',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('consultation_id', sa.String(length=36), nullable=False),
    sa.Column('role', sa.String(length=20), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('attachments_json', sa.JSON(), nullable=False),
    sa.Column('risk', sa.Boolean(), nullable=False),
    sa.Column('sequence', sa.Integer(), nullable=False),
    sa.Column('source', sa.String(length=30), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['consultation_id'], ['consultations.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('consultation_id', 'sequence', name='uq_consultation_sequence')
    )
    op.create_index(op.f('ix_consultation_messages_consultation_id'), 'consultation_messages', ['consultation_id'], unique=False)
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
    op.create_index(op.f('ix_lawyer_reviews_application_id'), 'lawyer_reviews', ['application_id'], unique=False)
    op.create_table('service_requests',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('owner_id', sa.String(length=36), nullable=False),
    sa.Column('source_consultation_id', sa.String(length=36), nullable=True),
    sa.Column('consent_id', sa.String(length=36), nullable=True),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('domain', sa.String(length=30), nullable=False),
    sa.Column('field', sa.String(length=100), nullable=False),
    sa.Column('service_type', sa.String(length=100), nullable=False),
    sa.Column('facts', sa.Text(), nullable=False),
    sa.Column('region', sa.String(length=100), nullable=False),
    sa.Column('budget', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('deadline', sa.Date(), nullable=False),
    sa.Column('deliverables', sa.Text(), nullable=False),
    sa.Column('visibility', sa.String(length=50), nullable=False),
    sa.Column('status', sa.String(length=30), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['consent_id'], ['consents.id'], ),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_service_requests_owner_id'), 'service_requests', ['owner_id'], unique=False)
    op.create_index(op.f('ix_service_requests_source_consultation_id'), 'service_requests', ['source_consultation_id'], unique=False)
    op.create_index(op.f('ix_service_requests_status'), 'service_requests', ['status'], unique=False)
    op.create_table('consultation_feedback',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('consultation_id', sa.String(length=36), nullable=False),
    sa.Column('message_id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('value', sa.String(length=20), nullable=False),
    sa.Column('reason', sa.String(length=500), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['consultation_id'], ['consultations.id'], ),
    sa.ForeignKeyConstraint(['message_id'], ['consultation_messages.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'message_id', name='uq_feedback_user_message')
    )
    op.create_index(op.f('ix_consultation_feedback_consultation_id'), 'consultation_feedback', ['consultation_id'], unique=False)
    op.create_index(op.f('ix_consultation_feedback_message_id'), 'consultation_feedback', ['message_id'], unique=False)
    op.create_index(op.f('ix_consultation_feedback_user_id'), 'consultation_feedback', ['user_id'], unique=False)
    op.create_table('quotes',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('request_id', sa.String(length=36), nullable=False),
    sa.Column('lawyer_id', sa.String(length=36), nullable=False),
    sa.Column('scope', sa.Text(), nullable=False),
    sa.Column('deliverables', sa.Text(), nullable=False),
    sa.Column('price', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('days', sa.Integer(), nullable=False),
    sa.Column('valid_until', sa.Date(), nullable=False),
    sa.Column('status', sa.String(length=30), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['lawyer_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['request_id'], ['service_requests.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_quotes_lawyer_id'), 'quotes', ['lawyer_id'], unique=False)
    op.create_index(op.f('ix_quotes_request_id'), 'quotes', ['request_id'], unique=False)
    op.create_index(op.f('ix_quotes_status'), 'quotes', ['status'], unique=False)
    op.create_index('uq_active_lawyer_quote', 'quotes', ['request_id', 'lawyer_id'], unique=True, postgresql_where=sa.text("status = 'valid'"), sqlite_where=sa.text("status = 'valid'"))
    op.create_table('orders',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('request_id', sa.String(length=36), nullable=False),
    sa.Column('quote_id', sa.String(length=36), nullable=False),
    sa.Column('client_id', sa.String(length=36), nullable=False),
    sa.Column('lawyer_id', sa.String(length=36), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('scope', sa.Text(), nullable=False),
    sa.Column('price', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('paid', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('status', sa.String(length=30), nullable=False),
    sa.Column('payment_status', sa.String(length=30), nullable=False),
    sa.Column('settlement_status', sa.String(length=30), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['client_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['lawyer_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['quote_id'], ['quotes.id'], ),
    sa.ForeignKeyConstraint(['request_id'], ['service_requests.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('quote_id')
    )
    op.create_index(op.f('ix_orders_client_id'), 'orders', ['client_id'], unique=False)
    op.create_index(op.f('ix_orders_lawyer_id'), 'orders', ['lawyer_id'], unique=False)
    op.create_index(op.f('ix_orders_request_id'), 'orders', ['request_id'], unique=True)
    op.create_index(op.f('ix_orders_status'), 'orders', ['status'], unique=False)
    op.create_table('after_sales_cases',
    sa.Column('previous_order_status', sa.String(length=30), nullable=False),
    sa.Column('previous_settlement_status', sa.String(length=30), nullable=False),
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('order_id', sa.String(length=36), nullable=False),
    sa.Column('created_by', sa.String(length=36), nullable=False),
    sa.Column('case_type', sa.String(length=30), nullable=False),
    sa.Column('reason', sa.String(length=2000), nullable=False),
    sa.Column('amount', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('status', sa.String(length=30), nullable=False),
    sa.Column('resolution', sa.String(length=2000), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['created_by'], ['users.id'], ),
    sa.ForeignKeyConstraint(['order_id'], ['orders.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_after_sales_cases_order_id'), 'after_sales_cases', ['order_id'], unique=False)
    op.create_index(op.f('ix_after_sales_cases_status'), 'after_sales_cases', ['status'], unique=False)
    op.create_table('documents',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('order_id', sa.String(length=36), nullable=False),
    sa.Column('owner_id', sa.String(length=36), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('doc_type', sa.String(length=40), nullable=False),
    sa.Column('status', sa.String(length=30), nullable=False),
    sa.Column('current_version', sa.Integer(), nullable=False),
    sa.Column('locked_version', sa.Integer(), nullable=True),
    sa.Column('members_json', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['order_id'], ['orders.id'], ),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_documents_order_id'), 'documents', ['order_id'], unique=False)
    op.create_index(op.f('ix_documents_owner_id'), 'documents', ['owner_id'], unique=False)
    op.create_index(op.f('ix_documents_status'), 'documents', ['status'], unique=False)
    op.create_table('payments',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('order_id', sa.String(length=36), nullable=False),
    sa.Column('provider', sa.String(length=40), nullable=False),
    sa.Column('intent_id', sa.String(length=100), nullable=False),
    sa.Column('amount', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('status', sa.String(length=30), nullable=False),
    sa.Column('provider_event_id', sa.String(length=150), nullable=True),
    sa.Column('merchant_id', sa.String(length=100), nullable=False),
    sa.Column('transaction_id', sa.String(length=150), nullable=True),
    sa.Column('client_params', sa.JSON(), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('refunded', sa.Numeric(precision=12, scale=2), nullable=False),
    sa.Column('attempts', sa.Integer(), nullable=False),
    sa.Column('next_attempt_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['order_id'], ['orders.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('intent_id'),
    sa.UniqueConstraint('provider_event_id')
    )
    op.create_index(op.f('ix_payments_next_attempt_at'), 'payments', ['next_attempt_at'], unique=False)
    op.create_index(op.f('ix_payments_order_id'), 'payments', ['order_id'], unique=False)
    op.create_index(op.f('ix_payments_status'), 'payments', ['status'], unique=False)
    op.create_index('uq_active_payment_order', 'payments', ['order_id'], unique=True, postgresql_where=sa.text("status IN ('creating','created','pending')"), sqlite_where=sa.text("status IN ('creating','created','pending')"))
    op.create_table('deliveries',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('order_id', sa.String(length=36), nullable=False),
    sa.Column('document_id', sa.String(length=36), nullable=True),
    sa.Column('submitted_by', sa.String(length=36), nullable=False),
    sa.Column('status', sa.String(length=30), nullable=False),
    sa.Column('reason', sa.String(length=1000), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ),
    sa.ForeignKeyConstraint(['order_id'], ['orders.id'], ),
    sa.ForeignKeyConstraint(['submitted_by'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_deliveries_order_id'), 'deliveries', ['order_id'], unique=False)
    op.create_table('document_access_grants',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('document_id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('can_view', sa.Boolean(), nullable=False),
    sa.Column('can_edit', sa.Boolean(), nullable=False),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('document_id', 'user_id', name='uq_document_access')
    )
    op.create_index(op.f('ix_document_access_grants_document_id'), 'document_access_grants', ['document_id'], unique=False)
    op.create_index(op.f('ix_document_access_grants_user_id'), 'document_access_grants', ['user_id'], unique=False)
    op.create_table('document_comments',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('document_id', sa.String(length=36), nullable=False),
    sa.Column('version_number', sa.Integer(), nullable=False),
    sa.Column('author_id', sa.String(length=36), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('resolved', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['author_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_document_comments_document_id'), 'document_comments', ['document_id'], unique=False)
    op.create_table('document_versions',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('document_id', sa.String(length=36), nullable=False),
    sa.Column('number', sa.Integer(), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('body_hash', sa.String(length=64), nullable=False),
    sa.Column('author_id', sa.String(length=36), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['author_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('document_id', 'number', name='uq_document_version')
    )
    op.create_index(op.f('ix_document_versions_document_id'), 'document_versions', ['document_id'], unique=False)
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
    op.create_index(op.f('ix_payment_transactions_payment_id'), 'payment_transactions', ['payment_id'], unique=False)
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
    op.create_index(op.f('ix_refunds_payment_id'), 'refunds', ['payment_id'], unique=False)
    op.create_index(op.f('ix_refunds_status'), 'refunds', ['status'], unique=False)
    op.create_table('workflow_tasks',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('document_id', sa.String(length=36), nullable=False),
    sa.Column('version_number', sa.Integer(), nullable=False),
    sa.Column('sequence', sa.Integer(), nullable=False),
    sa.Column('assignee_id', sa.String(length=36), nullable=False),
    sa.Column('status', sa.String(length=30), nullable=False),
    sa.Column('reason', sa.String(length=1000), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['assignee_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('document_id', 'version_number', 'sequence', name='uq_workflow_task')
    )
    op.create_index(op.f('ix_workflow_tasks_assignee_id'), 'workflow_tasks', ['assignee_id'], unique=False)
    op.create_index(op.f('ix_workflow_tasks_document_id'), 'workflow_tasks', ['document_id'], unique=False)
    op.create_index(op.f('ix_workflow_tasks_status'), 'workflow_tasks', ['status'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_workflow_tasks_status'), table_name='workflow_tasks')
    op.drop_index(op.f('ix_workflow_tasks_document_id'), table_name='workflow_tasks')
    op.drop_index(op.f('ix_workflow_tasks_assignee_id'), table_name='workflow_tasks')
    op.drop_table('workflow_tasks')
    op.drop_index(op.f('ix_refunds_status'), table_name='refunds')
    op.drop_index(op.f('ix_refunds_payment_id'), table_name='refunds')
    op.drop_table('refunds')
    op.drop_index(op.f('ix_payment_transactions_payment_id'), table_name='payment_transactions')
    op.drop_table('payment_transactions')
    op.drop_index(op.f('ix_document_versions_document_id'), table_name='document_versions')
    op.drop_table('document_versions')
    op.drop_index(op.f('ix_document_comments_document_id'), table_name='document_comments')
    op.drop_table('document_comments')
    op.drop_index(op.f('ix_document_access_grants_user_id'), table_name='document_access_grants')
    op.drop_index(op.f('ix_document_access_grants_document_id'), table_name='document_access_grants')
    op.drop_table('document_access_grants')
    op.drop_index(op.f('ix_deliveries_order_id'), table_name='deliveries')
    op.drop_table('deliveries')
    op.drop_index('uq_active_payment_order', table_name='payments', postgresql_where=sa.text("status IN ('creating','created','pending')"), sqlite_where=sa.text("status IN ('creating','created','pending')"))
    op.drop_index(op.f('ix_payments_status'), table_name='payments')
    op.drop_index(op.f('ix_payments_order_id'), table_name='payments')
    op.drop_index(op.f('ix_payments_next_attempt_at'), table_name='payments')
    op.drop_table('payments')
    op.drop_index(op.f('ix_documents_status'), table_name='documents')
    op.drop_index(op.f('ix_documents_owner_id'), table_name='documents')
    op.drop_index(op.f('ix_documents_order_id'), table_name='documents')
    op.drop_table('documents')
    op.drop_index(op.f('ix_after_sales_cases_status'), table_name='after_sales_cases')
    op.drop_index(op.f('ix_after_sales_cases_order_id'), table_name='after_sales_cases')
    op.drop_table('after_sales_cases')
    op.drop_index(op.f('ix_orders_status'), table_name='orders')
    op.drop_index(op.f('ix_orders_request_id'), table_name='orders')
    op.drop_index(op.f('ix_orders_lawyer_id'), table_name='orders')
    op.drop_index(op.f('ix_orders_client_id'), table_name='orders')
    op.drop_table('orders')
    op.drop_index('uq_active_lawyer_quote', table_name='quotes', postgresql_where=sa.text("status = 'valid'"), sqlite_where=sa.text("status = 'valid'"))
    op.drop_index(op.f('ix_quotes_status'), table_name='quotes')
    op.drop_index(op.f('ix_quotes_request_id'), table_name='quotes')
    op.drop_index(op.f('ix_quotes_lawyer_id'), table_name='quotes')
    op.drop_table('quotes')
    op.drop_index(op.f('ix_consultation_feedback_user_id'), table_name='consultation_feedback')
    op.drop_index(op.f('ix_consultation_feedback_message_id'), table_name='consultation_feedback')
    op.drop_index(op.f('ix_consultation_feedback_consultation_id'), table_name='consultation_feedback')
    op.drop_table('consultation_feedback')
    op.drop_index(op.f('ix_service_requests_status'), table_name='service_requests')
    op.drop_index(op.f('ix_service_requests_source_consultation_id'), table_name='service_requests')
    op.drop_index(op.f('ix_service_requests_owner_id'), table_name='service_requests')
    op.drop_table('service_requests')
    op.drop_index(op.f('ix_lawyer_reviews_application_id'), table_name='lawyer_reviews')
    op.drop_table('lawyer_reviews')
    op.drop_index(op.f('ix_consultation_messages_consultation_id'), table_name='consultation_messages')
    op.drop_table('consultation_messages')
    op.drop_table('user_roles')
    op.drop_index(op.f('ix_stored_files_status'), table_name='stored_files')
    op.drop_index(op.f('ix_stored_files_sha256'), table_name='stored_files')
    op.drop_index(op.f('ix_stored_files_owner_id'), table_name='stored_files')
    op.drop_index(op.f('ix_stored_files_document_id'), table_name='stored_files')
    op.drop_table('stored_files')
    op.drop_index(op.f('ix_notifications_user_id'), table_name='notifications')
    op.drop_index(op.f('ix_notifications_created_at'), table_name='notifications')
    op.drop_table('notifications')
    op.drop_index('uq_approved_lawyer_license', table_name='lawyer_profiles', postgresql_where=sa.text("status = 'approved' AND license_number <> ''"), sqlite_where=sa.text("status = 'approved' AND license_number <> ''"))
    op.drop_index(op.f('ix_lawyer_profiles_status'), table_name='lawyer_profiles')
    op.drop_index(op.f('ix_lawyer_profiles_available'), table_name='lawyer_profiles')
    op.drop_table('lawyer_profiles')
    op.drop_index('uq_lawyer_active_application', table_name='lawyer_applications', postgresql_where=sa.text("status IN ('submitted','under_review','draft')"), sqlite_where=sa.text("status IN ('submitted','under_review','draft')"))
    op.drop_index(op.f('ix_lawyer_applications_user_id'), table_name='lawyer_applications')
    op.drop_index(op.f('ix_lawyer_applications_status'), table_name='lawyer_applications')
    op.drop_table('lawyer_applications')
    op.drop_index(op.f('ix_idempotency_records_actor_id'), table_name='idempotency_records')
    op.drop_table('idempotency_records')
    op.drop_index(op.f('ix_email_verifications_user_id'), table_name='email_verifications')
    op.drop_table('email_verifications')
    op.drop_index(op.f('ix_consultations_owner_id'), table_name='consultations')
    op.drop_table('consultations')
    op.drop_index(op.f('ix_consents_source_id'), table_name='consents')
    op.drop_index(op.f('ix_consents_owner_id'), table_name='consents')
    op.drop_table('consents')
    op.drop_index(op.f('ix_users_role'), table_name='users')
    op.drop_index(op.f('ix_users_org_id'), table_name='users')
    op.drop_index(op.f('ix_users_email'), table_name='users')
    op.drop_table('users')
    op.drop_index(op.f('ix_payment_webhook_inbox_status'), table_name='payment_webhook_inbox')
    op.drop_index(op.f('ix_payment_webhook_inbox_next_attempt_at'), table_name='payment_webhook_inbox')
    op.drop_table('payment_webhook_inbox')
    op.drop_index(op.f('ix_outbox_events_event_type'), table_name='outbox_events')
    op.drop_index(op.f('ix_outbox_events_created_at'), table_name='outbox_events')
    op.drop_index(op.f('ix_outbox_events_aggregate_id'), table_name='outbox_events')
    op.drop_table('outbox_events')
    op.drop_table('health_probes')
    op.drop_index(op.f('ix_audit_logs_object_id'), table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_created_at'), table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_actor_id'), table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_action'), table_name='audit_logs')
    op.drop_table('audit_logs')
