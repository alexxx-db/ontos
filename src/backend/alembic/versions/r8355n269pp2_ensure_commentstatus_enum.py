"""Ensure commentstatus enum type exists

Revision ID: r8355n269pp2
Revises: 5845de034cb6
Create Date: 2026-01-27

This migration ensures the commentstatus PostgreSQL enum type exists.
The enum was previously only created by SQLAlchemy's create_all() for fresh databases,
causing errors for databases created before the comments feature was added.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'r8355n269pp2'
down_revision: Union[str, None] = '5845de034cb6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create the commentstatus enum if it doesn't exist
    # This fixes databases that were upgraded via migrations rather than created fresh
    conn = op.get_bind()
    
    # Check if the enum type exists
    result = conn.execute(sa.text(
        "SELECT 1 FROM pg_type WHERE typname = 'commentstatus'"
    ))
    enum_exists = result.scalar() is not None
    
    if not enum_exists:
        # Create the enum type
        comment_status_enum = postgresql.ENUM('active', 'deleted', name='commentstatus', create_type=False)
        comment_status_enum.create(conn, checkfirst=True)
    else:
        # Enum exists, ensure all required values are present
        # Get existing enum values
        result = conn.execute(sa.text("""
            SELECT enumlabel FROM pg_enum 
            WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'commentstatus')
        """))
        existing_values = {row[0] for row in result}
        
        # Add missing values (PostgreSQL 9.1+ supports ADD VALUE IF NOT EXISTS)
        required_values = ['active', 'deleted']
        for value in required_values:
            if value not in existing_values:
                # Note: ADD VALUE cannot run inside a transaction block in some PG versions
                # Using IF NOT EXISTS for safety
                conn.execute(sa.text(
                    f"ALTER TYPE commentstatus ADD VALUE IF NOT EXISTS '{value}'"
                ))


def downgrade() -> None:
    # Don't drop the enum as the comments table might still reference it
    # and dropping would cause data loss
    pass

