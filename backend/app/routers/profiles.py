"""Persisted profile, language, avatar, and age-derived/manual display preferences."""

from typing import Literal
from uuid import UUID, uuid4

import asyncpg
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app import storage
from app.accounts import account_name
from app.auth import CurrentUser
from app.avatars import Preset, Style, public_url
from app.db import pool

router = APIRouter(prefix="/api/profile", tags=["profile"])

DisplayMode = Literal["regular", "simplified", "extra_simple"]
PreferredLanguage = Literal["en", "es", "hi"]


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
    ui_mode: DisplayMode = "simplified"
    ui_mode_is_manual: bool = False
    preferred_language: PreferredLanguage = "en"
    avatar_style: Style | None = None
    avatar_preset: Preset | None = None
    # The uploaded photo only; the illustration is chosen from style/preset and age.
    avatar_url: str | None = None


class UpdateProfile(BaseModel):
    display_name: str | None = None
    age: int | None = Field(default=None, ge=0, le=130)
    ui_mode: DisplayMode | None = None
    preferred_language: PreferredLanguage | None = None
    avatar_style: Style | None = None
    # Send null to go back to the illustration for avatar_style and age.
    avatar_preset: Preset | None = None

    @field_validator("ui_mode", "preferred_language")
    @classmethod
    def preferences_cannot_be_cleared(cls, value: str | None) -> str:
        if value is None:
            raise ValueError("preference cannot be null")
        return value


_SELECT = """
    select user_id::text, display_name, age, ui_mode, ui_mode_overridden as ui_mode_is_manual,
           preferred_language, avatar_style, avatar_preset, avatar_path
    from profile where user_id = $1
"""

MAX_PHOTO_BYTES = 15 * 1024 * 1024


def _profile(row: asyncpg.Record) -> Profile:
    path = row["avatar_path"]
    return Profile(**row, avatar_url=public_url(path) if path else None)


async def _ensure_row(conn: asyncpg.Connection, user_id: UUID) -> None:
    await conn.execute(
        "insert into profile (user_id, display_name) values ($1, $2) on conflict do nothing",
        user_id,
        await account_name(conn, user_id),
    )


@router.get("")
async def get_profile(user: CurrentUser) -> Profile:
    async with pool().acquire() as conn:
        r = await conn.fetchrow(_SELECT, user.id)
        if r is None:
            return Profile(
                user_id=str(user.id),
                display_name=await account_name(conn, user.id),
                age=None,
                ui_mode="simplified",
                ui_mode_is_manual=False,
                preferred_language="en",
            )
    return _profile(r)


@router.patch("")
async def update_profile(body: UpdateProfile, user: CurrentUser) -> Profile:
    async with pool().acquire() as conn:
        cur = await conn.fetchrow(
            "select age, ui_mode, ui_mode_overridden, preferred_language, avatar_style, "
            "avatar_preset from profile where user_id = $1",
            user.id,
        )
        age = body.age if body.age is not None else (cur["age"] if cur else None)
        if body.ui_mode is not None:
            mode = body.ui_mode
            mode_is_manual = True
        elif body.age is not None and not (cur and cur["ui_mode_overridden"]):
            mode = default_mode(body.age)
            mode_is_manual = False
        else:
            mode = cur["ui_mode"] if cur else "simplified"
            mode_is_manual = cur["ui_mode_overridden"] if cur else False
        language = (
            body.preferred_language
            if body.preferred_language is not None
            else (cur["preferred_language"] if cur else "en")
        )
        name = (
            body.display_name
            if body.display_name is not None
            else await account_name(conn, user.id)
        )
        style = body.avatar_style or (cur["avatar_style"] if cur else None)
        preset = (
            body.avatar_preset
            if "avatar_preset" in body.model_fields_set
            else (cur["avatar_preset"] if cur else None)
        )
        await conn.execute(
            """
            insert into profile (user_id, display_name, age, ui_mode, ui_mode_overridden,
                                 preferred_language, avatar_style, avatar_preset)
            values ($1, $2, $3, $4, $5, $6, $7, $8)
            on conflict (user_id) do update set
              display_name = excluded.display_name,
              age = excluded.age,
              ui_mode = excluded.ui_mode,
              ui_mode_overridden = excluded.ui_mode_overridden,
              preferred_language = excluded.preferred_language,
              avatar_style = excluded.avatar_style,
              avatar_preset = excluded.avatar_preset
            """,
            user.id,
            name,
            age,
            mode,
            mode_is_manual,
            language,
            style,
            preset,
        )
        r = await conn.fetchrow(_SELECT, user.id)
    return _profile(r)


class StartAvatarUpload(BaseModel):
    photo_mime: str


class AvatarUpload(BaseModel):
    upload_url: str
    avatar_path: str


class FinishAvatarUpload(BaseModel):
    avatar_path: str


@router.post("/avatar")
async def start_avatar_upload(body: StartAvatarUpload, user: CurrentUser) -> AvatarUpload:
    mime = body.photo_mime.split(";")[0].strip().lower()
    ext = storage.extension(mime)
    if not mime.startswith("image/") or ext is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "choose a photo file.")
    path = f"users/{user.id}/{uuid4()}.{ext}"
    return AvatarUpload(
        upload_url=await storage.signed_upload_url("avatars", path), avatar_path=path
    )


@router.post("/avatar/complete")
async def finish_avatar_upload(body: FinishAvatarUpload, user: CurrentUser) -> Profile:
    path = body.avatar_path
    prefix = f"users/{user.id}/"
    if not path.startswith(prefix) or "/" in path[len(prefix) :] or ".." in path:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "that upload is not yours.")
    info = await storage.object_info("avatars", path)
    if info is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "the photo did not upload.")
    if not info.mime.startswith("image/") or info.byte_size > MAX_PHOTO_BYTES:
        await storage.delete_objects("avatars", [path])
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "that photo is too big (max 15 MB)."
        )
    async with pool().acquire() as conn, conn.transaction():
        await _ensure_row(conn, user.id)
        previous = await conn.fetchval(
            "select avatar_path from profile where user_id = $1 for update", user.id
        )
        await conn.execute("update profile set avatar_path = $2 where user_id = $1", user.id, path)
        r = await conn.fetchrow(_SELECT, user.id)
    if previous and previous != path:
        await storage.delete_objects("avatars", [previous])
    return _profile(r)


@router.delete("/avatar")
async def remove_avatar(user: CurrentUser) -> Profile:
    async with pool().acquire() as conn, conn.transaction():
        await _ensure_row(conn, user.id)
        previous = await conn.fetchval(
            "select avatar_path from profile where user_id = $1 for update", user.id
        )
        await conn.execute("update profile set avatar_path = null where user_id = $1", user.id)
        r = await conn.fetchrow(_SELECT, user.id)
    if previous:
        await storage.delete_objects("avatars", [previous])
    return _profile(r)
