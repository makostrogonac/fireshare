"""add share_token column to video_info

Revision ID: o0j1k2l3m4n5
Revises: n9i0j1k2l3m4
Create Date: 2026-06-18 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'o0j1k2l3m4n5'
down_revision = 'n9i0j1k2l3m4'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('video_info', schema=None) as batch_op:
        batch_op.add_column(sa.Column('share_token', sa.String(length=64), nullable=True))
        batch_op.create_index('ix_video_info_share_token', ['share_token'], unique=True)


def downgrade():
    with op.batch_alter_table('video_info', schema=None) as batch_op:
        batch_op.drop_index('ix_video_info_share_token', type_='unique')
        batch_op.drop_column('share_token')
