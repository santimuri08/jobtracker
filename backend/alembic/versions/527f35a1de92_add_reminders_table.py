"""add reminders table

Revision ID: 527f35a1de92
Revises: 8c09502dc527
Create Date: 2026-05-11 20:55:00.000000
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '527f35a1de92'
down_revision = '8c09502dc527'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'reminders',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column(
            'user_id',
            sa.String(),
            sa.ForeignKey('users.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column(
            'application_id',
            sa.Integer(),
            sa.ForeignKey('applications.id', ondelete='CASCADE'),
            nullable=True,
        ),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('due_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        # Future-proofing for notifications (Phase 2.3+):
        sa.Column('notified_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('notification_channel', sa.String(), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    # Indexes for the queries we'll actually run
    op.create_index('ix_reminders_user_id', 'reminders', ['user_id'])
    op.create_index('ix_reminders_due_at', 'reminders', ['due_at'])
    op.create_index('ix_reminders_completed_at', 'reminders', ['completed_at'])
    op.create_index('ix_reminders_application_id', 'reminders', ['application_id'])


def downgrade() -> None:
    op.drop_index('ix_reminders_application_id', table_name='reminders')
    op.drop_index('ix_reminders_completed_at', table_name='reminders')
    op.drop_index('ix_reminders_due_at', table_name='reminders')
    op.drop_index('ix_reminders_user_id', table_name='reminders')
    op.drop_table('reminders')