"""Testing-only email-only login. Enabled with DEV_PASSWORDLESS_LOGIN=true.

POST /api/dev/login with {"email": "..."} returns a dev bearer token (no password,
no email link). The token only verifies when the backend flag is on, so keep the
flag off in production.
"""

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, field_validator

from app.auth import dev_token_for_user_id, dev_user_id_for_email
from app.config import get_settings
from app.db import pool

router = APIRouter(prefix="/api/dev", tags=["dev-auth"])


class DevLoginRequest(BaseModel):
    email: str

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str) -> str:
        email = value.strip().lower()
        if "@" not in email or "." not in email.split("@")[-1]:
            raise ValueError("add a valid email.")
        return email


class DevLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    email: str


@router.post("/login", response_model=DevLoginResponse)
async def dev_login(body: DevLoginRequest) -> DevLoginResponse:
    if not get_settings().dev_passwordless_login:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found")
    async with pool().acquire() as conn:
        # If this email already belongs to a real (password/magic-link) account, log
        # into that account instead of minting a fresh dev identity. Otherwise the
        # caller would land in an empty account and lose their families/stories.
        user_id = await conn.fetchval(
            "select id from auth.users where lower(email) = lower($1) limit 1",
            body.email,
        )
        if user_id is None:
            user_id = dev_user_id_for_email(body.email)
            # member/profile rows FK to auth.users, so make sure the dev user exists.
            await conn.execute(
                "insert into auth.users (id) values ($1) on conflict do nothing", user_id
            )
    return DevLoginResponse(
        access_token=dev_token_for_user_id(user_id),
        user_id=str(user_id),
        email=body.email,
    )
