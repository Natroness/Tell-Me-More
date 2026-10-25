"""Opt-in Storytime, with an immutable request ledger and retained playback on regeneration."""

import shutil
from datetime import datetime
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from app import storage
from app.auth import CurrentUser, family_of_heirloom, require_member
from app.config import get_settings
from app.db import pool
from app.jobs.queue import enqueue

router = APIRouter(prefix="/api", tags=["storytime"])
Status = Literal["queued", "scripting", "gathering", "narrating", "rendering", "ready", "failed"]


class StockCredit(BaseModel):
    photographer: str
    page_url: str
    provider: str = "Pixabay"
    asset_id: str = ""
    license_url: str = "https://pixabay.com/service/license-summary/"


class StorytimeVideo(BaseModel):
    id: UUID | None = None
    status: Status | None = None
    updated_at: datetime | None = None
    stale: bool = False
    can_manage: bool = False
    video_url: str | None = None
    poster_url: str | None = None
    duration_ms: int | None = None
    credits: list[StockCredit] = Field(default_factory=list)
    error: str | None = None


class StorytimeAvailability(BaseModel):
    available: bool


def enabled():
    if not get_settings().storytime_enabled:
        raise HTTPException(404, "not found")


def available() -> bool:
    s = get_settings()
    return bool(
        s.storytime_enabled
        and s.gemini_api_key
        and shutil.which(s.ffmpeg_binary)
        and shutil.which(s.ffprobe_binary)
    )


@router.get("/storytime/available")
async def availability(user: CurrentUser) -> StorytimeAvailability:
    return StorytimeAvailability(available=available())


async def can_manage(conn, user, heirloom_id):
    return bool(
        await conn.fetchval(
            "select 1 from heirloom h join member m on m.family_id=h.family_id and m.user_id=$2 "
            "left join lateral (select storyteller_id from story where heirloom_id=h.id "
            "and status='published' order by version desc limit 1) s on true "
            "where h.id=$1 and (m.role='owner' or s.storyteller_id=m.person_id "
            "or (s.storyteller_id is null and h.created_by=$2))",
            heirloom_id,
            user.id,
        )
    )


SELECT = """
select st.*,vm.storage_path as video_path,pm.storage_path as poster_path,
       latest.id as latest_story_id,
       coalesce(a.assets->'credits','[]'::jsonb) as video_credits
from storytime st
left join media vm on vm.id=st.video_media_id
left join media pm on pm.id=st.poster_media_id
left join lateral (select id from story where heirloom_id=st.heirloom_id and status='published'
                   order by version desc limit 1) latest on true
left join storytime_attempt a on a.id::text = split_part(vm.storage_path,'/',4)
"""


async def resolve(row, manage=False):
    if row is None:
        return StorytimeVideo(can_manage=manage)
    video = row["video_path"]
    poster = row["poster_path"]
    return StorytimeVideo(
        id=row["id"],
        status=row["status"],
        updated_at=row["updated_at"],
        can_manage=manage,
        stale=bool(video and row["video_story_id"] != row["latest_story_id"]),
        video_url=await storage.signed_download_url("generated", video, expires_in=21600)
        if video
        else None,
        poster_url=await storage.signed_download_url("generated", poster, expires_in=21600)
        if poster
        else None,
        duration_ms=row["duration_ms"],
        credits=row["video_credits"],
        error=row["error"],
    )


@router.post("/stories/{heirloom_id}/storytime")
async def create(heirloom_id: UUID, user: CurrentUser, response: Response) -> StorytimeVideo:
    enabled()
    if not available():
        raise HTTPException(503, "Video creation is not configured yet")
    async with pool().acquire() as conn:
        family_id = await family_of_heirloom(conn, heirloom_id)
        await require_member(conn, user, family_id)
        if not await can_manage(conn, user, heirloom_id):
            raise HTTPException(403, "Only the storyteller or family owner can make this video")
        async with conn.transaction():
            # Serialize the cap check across all objects and regenerations in this family.
            await conn.fetchval("select id from family where id=$1 for update", family_id)
            story_id = await conn.fetchval(
                "select id from story where heirloom_id=$1 and status='published' "
                "order by version desc limit 1",
                heirloom_id,
            )
            if not story_id:
                raise HTTPException(409, "Publish the story before making its video")
            existing = await conn.fetchrow(
                "select * from storytime where heirloom_id=$1 for update", heirloom_id
            )
            if existing and existing["status"] not in ("ready", "failed"):
                response.status_code = 200
            else:
                count = await conn.fetchval(
                    "select count(*) from storytime_attempt where family_id=$1 "
                    "and created_at > now()-interval '24 hours'",
                    family_id,
                )
                if count >= get_settings().storytime_daily_limit_per_family:
                    raise HTTPException(
                        429, "Your family has made the most videos for today. Try again tomorrow."
                    )
                attempt_id = uuid4()
                st_id = await conn.fetchval(
                    "insert into "
                    "storytime(family_id,heirloom_id,story_id,requested_by,generation_id) "
                    "values($1,$2,$3,$4,$5) on conflict(heirloom_id) do update set "
                    "story_id=excluded.story_id,requested_by=excluded.requested_by,"
                    "generation_id=excluded.generation_id,status='queued',storyboard=null,assets='{}',"
                    "error=null,updated_at=now() returning id",
                    family_id,
                    heirloom_id,
                    story_id,
                    user.id,
                    attempt_id,
                )
                await conn.execute(
                    "insert into "
                    "storytime_attempt(id,family_id,heirloom_id,storytime_id,requested_by) "
                    "values($1,$2,$3,$4,$5)",
                    attempt_id,
                    family_id,
                    heirloom_id,
                    st_id,
                    user.id,
                )
                await enqueue(conn, "storytime_script", attempt_id, family_id)
                response.status_code = 202
        row = await conn.fetchrow(SELECT + "where st.heirloom_id=$1", heirloom_id)
    return await resolve(row, True)


@router.get("/stories/{heirloom_id}/storytime")
async def get(heirloom_id: UUID, user: CurrentUser) -> StorytimeVideo:
    enabled()
    async with pool().acquire() as conn:
        await require_member(conn, user, await family_of_heirloom(conn, heirloom_id))
        manage = await can_manage(conn, user, heirloom_id)
        row = await conn.fetchrow(SELECT + "where st.heirloom_id=$1", heirloom_id)
    return await resolve(row, manage)


@router.get("/public/stories/{heirloom_id}/storytime")
async def get_public(heirloom_id: UUID, k: str) -> StorytimeVideo:
    enabled()
    async with pool().acquire() as conn:
        row = await conn.fetchrow(
            SELECT + "join family f on f.id=st.family_id where st.heirloom_id=$1 "
            "and f.invite_code=$2 and st.video_media_id is not null",
            heirloom_id,
            k,
        )
    if row is None:
        raise HTTPException(404, "video not found")
    # Public viewers see the last completed video, including during a replacement render.
    result = await resolve(row)
    return result.model_copy(update={"status": "ready", "error": None})


@router.delete("/stories/{heirloom_id}/storytime", status_code=204)
async def remove(heirloom_id: UUID, user: CurrentUser) -> None:
    enabled()
    async with pool().acquire() as conn:
        family_id = await family_of_heirloom(conn, heirloom_id)
        await require_member(conn, user, family_id)
        if not await can_manage(conn, user, heirloom_id):
            raise HTTPException(403, "Only the storyteller or family owner can remove this video")
        async with conn.transaction():
            # Same order as Create: family, then Storytime.
            await conn.fetchval("select id from family where id=$1 for update", family_id)
            await conn.execute("delete from storytime where heirloom_id=$1", heirloom_id)
            attempts = await conn.fetch(
                "select id,assets from storytime_attempt where heirloom_id=$1", heirloom_id
            )
            paths = {
                v["path"]
                for a in attempts
                for v in a["assets"].values()
                if isinstance(v, dict) and "path" in v
            }
            await conn.execute(
                "delete from media where heirloom_id=$1 and storage_path like $2",
                heirloom_id,
                f"{family_id}/{heirloom_id}/storytime/%",
            )
            await conn.execute(
                "delete from job where subject_id=any($1::uuid[]) and kind=any($2::text[])",
                [a["id"] for a in attempts],
                ["storytime_script", "storytime_render"],
            )
    await storage.remove("generated", sorted(paths))
