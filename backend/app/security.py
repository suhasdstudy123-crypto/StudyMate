"""
Security primitives: password hashing and JWT tokens.

This file knows nothing about HTTP or routes. It only answers:
  * "turn this password into a safe hash"      -> hash_password
  * "does this password match this hash?"      -> verify_password
  * "make a signed token saying who this is"   -> create_access_token
  * "is this token genuine and unexpired?"     -> decode_access_token
"""

from datetime import datetime, timedelta, timezone
from uuid import UUID

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from backend.app.config import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    JWT_ALGORITHM,
    JWT_SECRET_KEY,
)

# ------------------------------------------------------------------
# Passwords (Argon2id)
# ------------------------------------------------------------------
# PasswordHasher uses Argon2id with the RFC 9106 recommended settings.
# Every hash gets its own random salt, stored inside the hash string:
#   $argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>
# so two users with the same password still get different hashes.
_hasher = PasswordHasher()

# A hash of a throwaway password, used when an email doesn't exist.
# Checking against it costs the same time as a real check, so an
# attacker can't tell "no such email" from "wrong password" by timing.
_DUMMY_HASH = _hasher.hash("timing-equaliser-not-a-real-password")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password)
    except (VerificationError, InvalidHashError):
        # VerificationError: wrong password.
        # InvalidHashError: the stored value isn't an Argon2 hash at all
        # (e.g. the old 'placeholder' test row) -> treat as wrong.
        return False


def needs_rehash(password_hash: str) -> bool:
    # True if this hash was made with weaker settings than today's.
    # On login we can then quietly upgrade it while we know the password.
    return _hasher.check_needs_rehash(password_hash)


# ------------------------------------------------------------------
# JWT access tokens
# ------------------------------------------------------------------

def create_access_token(user_id: UUID) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),  # subject: WHO this token is about
        "iat": now,           # issued at
        "exp": now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),  # expiry
    }
    # Result: header.payload.signature (each part base64url-encoded).
    # The payload is readable by anyone; the signature makes it tamper-proof.
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> UUID | None:
    """Return the user id inside a valid token, or None if invalid/expired."""
    try:
        payload = jwt.decode(
            token,
            JWT_SECRET_KEY,
            # Pin the algorithm: never let the token's own header choose it.
            algorithms=[JWT_ALGORITHM],
            options={"require": ["sub", "exp", "iat"]},
        )
        return UUID(payload["sub"])
    except (jwt.PyJWTError, ValueError):
        # Bad signature, expired, malformed, or sub isn't a UUID.
        return None
