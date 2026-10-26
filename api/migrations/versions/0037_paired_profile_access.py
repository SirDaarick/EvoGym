"""Add revocable proof bindings and Admin-backed profile access."""

from alembic import context, op
import sqlalchemy as sa


revision = "0037_paired_profile_access"
down_revision = "0036_staff_lockout_alert_ack"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    if not context.is_offline_mode():
        ambiguous_codes = connection.execute(sa.text(
            "SELECT count(*) FROM ("
            "SELECT code_hash FROM staff_device_pairing_codes "
            "WHERE used_at IS NULL AND revoked_at IS NULL "
            "GROUP BY code_hash HAVING count(*) > 1)"
        )).scalar_one()
        if ambiguous_codes:
            raise RuntimeError("Cannot enable globally unique active pairing codes while ambiguous codes remain")

    with op.batch_alter_table("staff_paired_devices") as batch_op:
        batch_op.add_column(sa.Column("profile_access_digest", sa.String(64), nullable=True))
        batch_op.add_column(sa.Column("profile_access_created_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("profile_access_last_used_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("profile_access_expires_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.create_check_constraint(
            "ck_staff_paired_devices_profile_access_digest",
            "profile_access_digest IS NULL OR length(profile_access_digest) = 64",
        )
    op.create_index(
        "uq_staff_paired_devices_profile_access_digest",
        "staff_paired_devices", ["profile_access_digest"], unique=True,
    )
    op.create_index(
        "uq_staff_active_pairing_code_hash",
        "staff_device_pairing_codes", ["code_hash"], unique=True,
        postgresql_where=sa.text("used_at IS NULL AND revoked_at IS NULL"),
        sqlite_where=sa.text("used_at IS NULL AND revoked_at IS NULL"),
    )
    with op.batch_alter_table("reception_stations") as batch_op:
        batch_op.add_column(sa.Column("source_admin_device_id", sa.Uuid(), nullable=True))
        batch_op.create_foreign_key(
            "fk_reception_station_source_device",
            "admin_trusted_devices", ["source_admin_device_id"], ["id"], ondelete="RESTRICT",
        )
    op.create_index(
        "uq_reception_stations_admin_device_branch_active",
        "reception_stations", ["source_admin_device_id", "branch_id"], unique=True,
        postgresql_where=sa.text("source_admin_device_id IS NOT NULL AND revoked_at IS NULL"),
        sqlite_where=sa.text("source_admin_device_id IS NOT NULL AND revoked_at IS NULL"),
    )


def downgrade() -> None:
    if context.is_offline_mode():
        raise RuntimeError("Cannot safely downgrade profile-access migration without inspecting stored credentials")
    connection = op.get_bind()
    if connection.dialect.name == "postgresql":
        connection.execute(sa.text(
            "LOCK TABLE staff_paired_devices, reception_stations IN ACCESS EXCLUSIVE MODE"
        ))
    active_proofs = connection.execute(sa.text(
        "SELECT count(*) FROM staff_paired_devices WHERE profile_access_digest IS NOT NULL"
    )).scalar_one()
    mapped_stations = connection.execute(sa.text(
        "SELECT count(*) FROM reception_stations WHERE source_admin_device_id IS NOT NULL"
    )).scalar_one()
    if active_proofs or mapped_stations:
        raise RuntimeError("Cannot downgrade while profile-access credentials or mapped stations remain")

    op.drop_index("uq_reception_stations_admin_device_branch_active", table_name="reception_stations")
    with op.batch_alter_table("reception_stations") as batch_op:
        batch_op.drop_constraint(
            "fk_reception_station_source_device", type_="foreignkey"
        )
        batch_op.drop_column("source_admin_device_id")
    op.drop_index("uq_staff_active_pairing_code_hash", table_name="staff_device_pairing_codes")
    op.drop_index("uq_staff_paired_devices_profile_access_digest", table_name="staff_paired_devices")
    with op.batch_alter_table("staff_paired_devices") as batch_op:
        batch_op.drop_constraint("ck_staff_paired_devices_profile_access_digest", type_="check")
        batch_op.drop_column("profile_access_expires_at")
        batch_op.drop_column("profile_access_last_used_at")
        batch_op.drop_column("profile_access_created_at")
        batch_op.drop_column("profile_access_digest")
