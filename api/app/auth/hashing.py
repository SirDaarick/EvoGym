import bcrypt


_BCRYPT_ROUNDS = 12


def _encode_pin(pin: str) -> bytes:
    if not isinstance(pin, str):
        raise TypeError("PIN must be text")
    encoded = pin.encode("utf-8")
    if len(encoded) > 72:
        raise ValueError("PIN must not exceed bcrypt's 72 bytes")
    return encoded


def hash_pin(pin: str) -> str:
    """Return a salted bcrypt hash without truncating overlong credentials."""
    return bcrypt.hashpw(_encode_pin(pin), bcrypt.gensalt(rounds=_BCRYPT_ROUNDS)).decode("ascii")


def verify_pin(pin: str, stored_hash: str) -> bool:
    """Verify a PIN, treating malformed stored hashes as ordinary denial."""
    try:
        return bcrypt.checkpw(_encode_pin(pin), stored_hash.encode("ascii"))
    except (ValueError, TypeError, UnicodeError):
        return False
