"""add audio mix settings

Revision ID: p1q2r3s4t5u6
Revises: o0j1k2l3m4n5
Create Date: 2026-06-23 00:00:00.000000

"""
import secrets

from alembic import op
import sqlalchemy as sa


revision = 'p1q2r3s4t5u6'
down_revision = 'o0j1k2l3m4n5'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('video_info', schema=None) as batch_op:
        batch_op.add_column(sa.Column('audio_tracks', sa.Text(), nullable=True))

    video_info = sa.table(
        'video_info',
        sa.column('id', sa.Integer),
        sa.column('password_hash', sa.String),
        sa.column('share_token', sa.String),
    )
    conn = op.get_bind()
    rows = conn.execute(
        sa.select(video_info.c.id).where(
            video_info.c.password_hash.isnot(None),
            video_info.c.share_token.is_(None),
        )
    ).fetchall()
    for (row_id,) in rows:
        conn.execute(
            video_info.update()
            .where(video_info.c.id == row_id)
            .values(share_token=secrets.token_urlsafe(16))
        )


def downgrade():
    with op.batch_alter_table('video_info', schema=None) as batch_op:
        batch_op.drop_column('audio_tracks')
