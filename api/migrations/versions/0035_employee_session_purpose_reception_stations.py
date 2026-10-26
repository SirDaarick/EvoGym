"""Bind employee sessions to server-owned phone or reception purpose."""

from alembic import op
import sqlalchemy as sa


revision = "0035_employee_session_lifecycle"
down_revision = "0034_owner_admin_role_bundles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reception_stations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("credential_digest", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("length(credential_digest) = 64", name="ck_reception_stations_digest"),
        sa.ForeignKeyConstraint(["branch_id"], ["branches.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by"], ["staff_users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("uq_reception_stations_credential_digest", "reception_stations", ["credential_digest"], unique=True)
    op.create_index("ix_reception_stations_branch_active", "reception_stations", ["branch_id", "revoked_at", "expires_at"])
    with op.batch_alter_table("staff_sessions") as batch_op:
        batch_op.add_column(sa.Column("employee_purpose", sa.String(length=16), nullable=True))
        batch_op.add_column(sa.Column("reception_station_id", sa.Uuid(), nullable=True))
        batch_op.create_foreign_key(
            "fk_staff_sessions_reception_station_id_reception_stations", "reception_stations",
            ["reception_station_id"], ["id"], ondelete="RESTRICT",
        )
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        from datetime import timedelta
        rows = bind.execute(sa.text(
            "SELECT id, issued_at, expires_at, last_seen_at FROM staff_sessions "
            "WHERE scope_kind = 'branch' AND auth_method = 'pin'"
        )).mappings().all()
        for row in rows:
            issued = row["issued_at"]
            expiry = row["expires_at"]
            absolute = min(expiry, issued + timedelta(days=90))
            bind.execute(sa.text(
                "UPDATE staff_sessions SET last_seen_at = :last_seen, absolute_expires_at = :absolute "
                "WHERE id = :id"
            ), {"last_seen": row["last_seen_at"] or issued, "absolute": absolute, "id": row["id"]})
        bind.execute(sa.text(
            "UPDATE staff_sessions SET employee_purpose = 'phone' "
            "WHERE scope_kind = 'branch' AND auth_method = 'pin'"
        ))
    else:
        op.execute(sa.text(
            "UPDATE staff_sessions SET employee_purpose = 'phone', "
            "last_seen_at = COALESCE(last_seen_at, issued_at), "
            "absolute_expires_at = CASE WHEN expires_at < issued_at + INTERVAL '90 days' "
            "THEN expires_at ELSE issued_at + INTERVAL '90 days' END "
            "WHERE scope_kind = 'branch' AND auth_method = 'pin'"
        ))
    with op.batch_alter_table("staff_sessions") as batch_op:
        batch_op.create_check_constraint(
            "ck_staff_sessions_employee_purpose",
            "(scope_kind = 'organization' AND employee_purpose IS NULL AND reception_station_id IS NULL) OR "
            "(scope_kind = 'branch' AND employee_purpose = 'phone' AND reception_station_id IS NULL) OR "
            "(scope_kind = 'branch' AND employee_purpose = 'reception' AND reception_station_id IS NOT NULL)",
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        # Prevent new Reception sessions/stations from appearing between the
        # data guard and the schema drop during a live downgrade transaction.
        bind.execute(sa.text("LOCK TABLE staff_sessions, reception_stations IN ACCESS EXCLUSIVE MODE"))
    reception_state = bind.execute(sa.text(
        "SELECT count(*) FROM reception_stations"
    )).scalar_one()
    non_phone_employee_sessions = bind.execute(sa.text(
        "SELECT count(*) FROM staff_sessions WHERE scope_kind = 'branch' AND auth_method = 'pin' "
        "AND (employee_purpose IS NULL OR employee_purpose <> 'phone' OR reception_station_id IS NOT NULL)"
    )).scalar_one()
    if reception_state or non_phone_employee_sessions:
        raise RuntimeError("Reception session or station state is retained")

    # Legacy branch-PIN rows whose purpose is phone remain representable by the
    # pre-0035 schema; their PIN, scope, expiry, and last-seen data are retained.
    with op.batch_alter_table("staff_sessions") as batch_op:
        batch_op.drop_constraint("ck_staff_sessions_employee_purpose", type_="check")
        batch_op.drop_constraint("fk_staff_sessions_reception_station_id_reception_stations", type_="foreignkey")
        batch_op.drop_column("reception_station_id")
        batch_op.drop_column("employee_purpose")
    op.drop_index("ix_reception_stations_branch_active", table_name="reception_stations")
    op.drop_index("uq_reception_stations_credential_digest", table_name="reception_stations")
    op.drop_table("reception_stations")
