"""add chats and chat messages

Revision ID: <leave the hash Alembic gave you>
Revises: 527f35a1de92
Create Date: <leave the date Alembic gave you>

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
# !!! DO NOT EDIT the two lines below — Alembic generated them.
revision = '10d96e033e2c'
down_revision = '527f35a1de92'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ---- chats ----
    op.create_table(
        'chats',
        sa.Column('id', sa.Text(), primary_key=True),
        sa.Column(
            'user_id',
            sa.String(),
            sa.ForeignKey('users.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column('title', sa.Text(), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index('ix_chats_user_id', 'chats', ['user_id'])
    op.create_index(
        'ix_chats_user_updated',
        'chats',
        ['user_id', sa.text('updated_at DESC')],
    )

    # ---- chat_messages ----
    op.create_table(
        'chat_messages',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column(
            'chat_id',
            sa.Text(),
            sa.ForeignKey('chats.id', ondelete='CASCADE'),
            nullable=False,
        ),
        sa.Column('position', sa.Integer(), nullable=False),
        sa.Column('role', sa.Text(), nullable=False),
        sa.Column('content', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint('chat_id', 'position', name='uq_chat_messages_chat_position'),
    )
    op.create_index('ix_chat_messages_chat_id', 'chat_messages', ['chat_id'])


def downgrade() -> None:
    op.drop_index('ix_chat_messages_chat_id', table_name='chat_messages')
    op.drop_table('chat_messages')

    op.drop_index('ix_chats_user_updated', table_name='chats')
    op.drop_index('ix_chats_user_id', table_name='chats')
    op.drop_table('chats')