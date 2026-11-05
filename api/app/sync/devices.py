"""Sync device provisioning, bearer-token authentication and revocation."""

import hashlib
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import SessionDep
from app.db.models.sync import SyncDevice
from app.errors import PublicDomainError

_STATION_CODE = re.compile(r"^[A-Z0-9]{2,8}$")
_bearer = HTTPBearer(auto_error=False)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def provision_device(
    session: Session,
    *,
    branch_id: UUID,
    station_code: str,
    reception_station_id: UUID | None,
    provisioned_by: UUID,
    ttl_days: int,
    rotate: bool = False,
    now: datetime | None = None,
) -> tuple[SyncDevice, str]:
    """Issue a new device token; the raw token is returned once and only its sha256 digest is stored.

    Re-provisioning a station (rotate or not: the raw token is unrecoverable) revokes the previous active device
    with the same prefix in this branch and continues its sequence (next seq = last_ingested_seq + 1).
    """
    code = station_code.strip().upper()
    if not _STATION_CODE.match(code):
        raise ValueError("station_code must be 2-8 characters of A-Z and 0-9")
    prefix = f"REC-{code}"
    issued_at = now or _now()
    active = session.scalars(
        select(SyncDevice).where(SyncDevice.device_prefix == prefix, SyncDevice.revoked_at.is_(None)).with_for_update()
    ).all()
    if any(device.branch_id != branch_id for device in active):
        raise ValueError("station_code is already in use by another branch")
    last_seq = 0
    for device in active:
        device.revoked_at = issued_at
        last_seq = max(last_seq, device.last_ingested_seq)
    if active:
        session.flush()  # free the partial-unique prefix slot before inserting the replacement
    # Sequence continuity also covers earlier revoked devices of this prefix.
    previous = session.scalars(
        select(SyncDevice.last_ingested_seq).where(SyncDevice.device_prefix == prefix, SyncDevice.branch_id == branch_id)
    ).all()
    last_seq = max([last_seq, *previous])
    raw_token = secrets.token_urlsafe(32)
    device = SyncDevice(
        branch_id=branch_id,
        reception_station_id=reception_station_id,
        device_prefix=prefix,
        token_digest=token_digest(raw_token),
        provisioned_by=provisioned_by,
        issued_at=issued_at,
        expires_at=issued_at + timedelta(days=ttl_days),
        last_ingested_seq=last_seq,
    )
    session.add(device)
    session.flush()
    return device, raw_token


def next_seq(device: SyncDevice) -> int:
    return device.last_ingested_seq + 1


def revoke_device(session: Session, device_id: UUID, *, now: datetime | None = None) -> SyncDevice | None:
    device = session.get(SyncDevice, device_id)
    if device is not None and device.revoked_at is None:
        device.revoked_at = now or _now()
        session.flush()
    return device


def authenticate_device_token(session: Session, token: str, *, now: datetime | None = None) -> SyncDevice:
    device = session.scalar(select(SyncDevice).where(SyncDevice.token_digest == token_digest(token)))
    if device is None:
        raise HTTPException(401, "Authentication failed.")
    if device.revoked_at is not None:
        raise PublicDomainError("sync_device_revoked")
    if _aware(device.expires_at) <= (now or _now()):
        raise PublicDomainError("sync_device_expired")
    return device


def get_sync_device(
    session: SessionDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> SyncDevice:
    if credentials is None or credentials.scheme.lower() != "bearer" or not credentials.credentials:
        raise HTTPException(401, "Authentication failed.")
    return authenticate_device_token(session, credentials.credentials)


SyncDeviceDep = Annotated[SyncDevice, Depends(get_sync_device)]
