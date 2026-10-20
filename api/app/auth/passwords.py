"""Password hashing isolated from the lower-entropy staff PIN primitive."""
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

_hasher = PasswordHasher()
# A valid synthetic hash keeps unknown login identifiers on the same verifier path.
_dummy_hash = "$argon2id$v=19$m=65536,t=3,p=4$HR/pybvltCCnJWKd8NX7AQ$T3ACBGqqztDKvkvBLZATGQhBMW573WAUymEqpmYriXw"


def hash_admin_password(password: str) -> str:
    if not isinstance(password, str) or not password or len(password.encode("utf-8")) > 4096:
        raise ValueError("Password input is invalid")
    return _hasher.hash(password)


def verify_admin_password(password: str, encoded: str) -> bool:
    if not isinstance(password, str) or len(password.encode("utf-8", errors="ignore")) > 4096:
        return False
    try:
        return _hasher.verify(encoded, password)
    except (VerifyMismatchError, InvalidHashError, VerificationError, TypeError, ValueError):
        return False


def burn_password_verification(password: str) -> None:
    verify_admin_password(password, _dummy_hash)
