from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated
from uuid import UUID

import asyncpg
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import get_settings

_bearer = HTTPBearer()


@dataclass(frozen=True)
class User:
    id: UUID


@lru_cache
def _jwks() -> jwt.PyJWKClient:
    return jwt.PyJWKClient(f"{get_settings().supabase_url}/auth/v1/.well-known/jwks.json")


def _decode(token: str) -> dict:
    # Projects on asymmetric signing keys (ES256/RS256) still accept legacy HS256 tokens during
    # rotation, so pick the verifier from the token's own header.
    if jwt.get_unverified_header(token).get("alg") == "HS256":
        secret = get_settings().supabase_jwt_secret
        if not secret:
            raise jwt.InvalidTokenError("HS256 token but SUPABASE_JWT_SECRET is not set")
        return jwt.decode(token, secret, algorithms=["HS256"], audience="authenticated")
    key = _jwks().get_signing_key_from_jwt(token)
    return jwt.decode(token, key.key, algorithms=["ES256", "RS256"], audience="authenticated")


def user_from_token(token: str) -> User:
    """Raises jwt.PyJWTError. Blocking on the first JWKS fetch, so call it off the event loop."""
    return User(id=UUID(_decode(token)["sub"]))


# Sync on purpose: FastAPI runs it in a threadpool, so the JWKS fetch never blocks the loop.
def current_user(creds: Annotated[HTTPAuthorizationCredentials, Depends(_bearer)]) -> User:
    try:
        return user_from_token(creds.credentials)
    except jwt.PyJWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid token") from e


CurrentUser = Annotated[User, Depends(current_user)]


async def require_member(conn: asyncpg.Connection, user: User, family_id: UUID) -> UUID:
    """Returns the caller's person_id in the family, or 403."""
    row = await conn.fetchrow(
        "select person_id from member where user_id = $1 and family_id = $2", user.id, family_id
    )
    if row is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not a member of this family")
    return row["person_id"]


async def family_of_heirloom(conn: asyncpg.Connection, heirloom_id: UUID) -> UUID:
    family_id = await conn.fetchval("select family_id from heirloom where id = $1", heirloom_id)
    if family_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "heirloom not found")
    return family_id
