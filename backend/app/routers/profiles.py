"""Profile prefs: age + display mode (Brief §5). Same account, Listener/Storyteller are roles."""

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.accounts import account_name
from app.auth import CurrentUser
from app.db import pool

router = APIRouter(prefix="/api/profile", tags=["profile"])


def default_mode(age: int | None) -> str:
    if age is None:
        return "simplified"
    if age < 18:
        return "regular"
    if age <= 50:
        return "simplified"
    return "extra_simple"


class Profile(BaseModel):
    user_id: str
    display_name: str | None = None
    age: int | None = None
    ui_mode: str = "simplified"


class UpdateProfile(BaseModel):
    display_name: str | None = None
    age: int | None = Field(default=None, ge=0, le=130)
    ui_mode: str | None = Field(default=None, pattern="^(regular|simplified|extra_simple)$")


@router.get("")
async def get_profile(user: CurrentUser) -> Profile:
    async with pool().acquire() as conn:
        r = await conn.fetchrow(
            "select user_id::text, display_name, age, ui_mode from profile where user_id = $1",
            user.id,
        )
        if r is None:
            return Profile(
                user_id=str(user.id),
                display_name=await account_name(conn, user.id),
                age=None,
                ui_mode="simplified",
            )
    return Profile(**r)


@router.patch("")
async def update_profile(body: UpdateProfile, user: CurrentUser) -> Profile:
    async with pool().acquire() as conn:
        cur = await conn.fetchrow("select age, ui_mode from profile where user_id = $1", user.id)
        age = body.age if body.age is not None else (cur["age"] if cur else None)
        if body.ui_mode is not None:
            mode = body.ui_mode
        elif body.age is not None:
            mode = default_mode(body.age)
        else:
            mode = cur["ui_mode"] if cur else "simplified"
        name = (
            body.display_name
            if body.display_name is not None
            else await account_name(conn, user.id)
        )
        r = await conn.fetchrow(
            """
            insert into profile (user_id, display_name, age, ui_mode)
            values ($1, $2, $3, $4)
            on conflict (user_id) do update set
              display_name = excluded.display_name,
              age = excluded.age,
              ui_mode = excluded.ui_mode
            returning user_id::text, display_name, age, ui_mode
            """,
            user.id,
            name,
            age,
            mode,
        )
    return Profile(**r)
