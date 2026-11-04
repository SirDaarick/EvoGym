"""Device pairing use cases. HTTP transport lives in `app.api.device_pairing`; SQL in `app.auth.devices`.

Failures are `HttpStatusError`s.
"""
from uuid import UUID

from app.auth.devices import (
    DevicePairingDenied,
    issue_device_pairing_code,
    list_paired_devices,
    pair_device,
    revoke_paired_device,
)
from app.errors import HttpStatusError, http_errors


def issue_pairing_code(factory, admin_id: UUID, staff_id: UUID, ttl_seconds: int, request_id: UUID):
    with http_errors((ValueError, 400)):
        return issue_device_pairing_code(
            factory, admin_id=admin_id, staff_id=staff_id, ttl_seconds=ttl_seconds, request_id=request_id,
        )


def list_devices(factory, admin_id: UUID):
    return list_paired_devices(factory, admin_id)


def revoke_device(factory, admin_id: UUID, device_id: UUID, request_id: UUID) -> None:
    if not revoke_paired_device(factory, admin_id, device_id, request_id=request_id):
        raise HttpStatusError(404)


def submit_pairing(factory, login_identifier: str, pairing_code: str, device_identifier: str, device_name: str,
                   request_id: UUID) -> UUID:
    with http_errors((DevicePairingDenied, 401)):
        return pair_device(
            factory, login_identifier=login_identifier, pairing_code_str=pairing_code,
            device_identifier_str=device_identifier, device_name=device_name, request_id=request_id,
        )
