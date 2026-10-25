"""Immersive memories (docs/IMMERSIVE.md §5.5): ask for a walkable world of a story photo, watch
it build, and walk through it. Every route answers 404 while the feature flag is off."""

from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID

import asyncpg
from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel

from app import storage
from app.auth import CurrentUser, family_of_heirloom, require_member
from app.config import get_settings
from app.db import pool
from app.jobs.queue import enqueue
from app.models import Hotspot, ReferencePhoto
from app.routers.stories import ResolvedSegment

router = APIRouter(prefix="/api", tags=["immersive"])

WorldStatus = Literal[
    "queued",
    "writing_scene",
    "finding_reference",
    "generating",
    "saving",
    "placing_spots",
    "ready",
    "failed",
]


class WorldSummary(BaseModel):
    id: UUID
    source_media_id: UUID
    status: WorldStatus
    updated_at: datetime
    thumbnail_url: str | None = None


class SpotFact(BaseModel):
    id: UUID
    text: str


class ResolvedSpot(BaseModel):
    id: str
    label: str
    u: float | None
    v: float | None
    facts: list[SpotFact]
    segments: list[ResolvedSegment]


class ReferenceCredit(BaseModel):
    """Distinguish public scene photos from generated interpretations of the setting."""

    title: str
    page_url: str | None = None
    kind: Literal["web", "generated"] = "web"


class ImmersiveWorld(BaseModel):
    id: UUID
    heirloom_id: UUID
    story_id: UUID | None
    status: WorldStatus
    error: str | None
    narrator: str | None
    label: str
    # Signed URLs: spz_100k, spz_500k, pano, thumbnail, collider (whichever exist).
    assets: dict[str, str]
    semantics: dict[str, float | None]
    spots: list[ResolvedSpot]
    reference: ReferenceCredit | None = None


def _enabled() -> None:
    if not get_settings().immersive_enabled:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found")


# A job that dies before its stage runs never touches the world, so its row would read "queued"
# forever. The job's own status settles it.
_JOB = "left join job j on j.kind = 'immersive_world' and j.subject_id = w.id"
_STATUS = "case when w.status <> 'ready' and j.status = 'failed' then 'failed' else w.status end"


async def _summary(row: asyncpg.Record) -> WorldSummary:
    thumb = (row["assets"] or {}).get("thumbnail") if row["status"] == "ready" else None
    return WorldSummary(
        id=row["id"],
        source_media_id=row["source_media_id"],
        status=row["status"],
        updated_at=row["updated_at"],
        thumbnail_url=await storage.signed_download_url("generated", thumb) if thumb else None,
    )


@router.post("/heirlooms/{heirloom_id}/photos/{media_id}/immersive")
async def create_world(
    heirloom_id: UUID, media_id: UUID, user: CurrentUser, response: Response
) -> WorldSummary:
    _enabled()
    s = get_settings()
    async with pool().acquire() as conn:
        family_id = await family_of_heirloom(conn, heirloom_id)
        person_id = await require_member(conn, user, family_id)
        photo = await conn.fetchval(
            "select 1 from media where id = $1 and heirloom_id = $2 and kind in ('photo', 'scan')",
            media_id,
            heirloom_id,
        )
        if not photo:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "photo not found")
        if not await conn.fetchval(
            "select 1 from fact where heirloom_id = $1 and kind = 'memory' limit 1", heirloom_id
        ):
            raise HTTPException(status.HTTP_409_CONFLICT, "Finish the interview first")
        story_id = await conn.fetchval(
            "select id from story where heirloom_id = $1 order by version desc limit 1",
            heirloom_id,
        )
        async with conn.transaction():
            existing = await conn.fetchrow(
                f"select w.id, w.source_media_id, {_STATUS} as status, w.assets, w.updated_at "
                f"from immersive_world w {_JOB} where w.source_media_id = $1 for update of w",
                media_id,
            )
            if existing and existing["status"] != "failed":
                return await _summary(existing)
            if existing:  # asking again after a failure: resume from what it already has
                world_id = existing["id"]
                await conn.execute(
                    "update immersive_world set status = 'queued', error = null, "
                    "story_id = $2, updated_at = now() where id = $1",
                    world_id,
                    story_id,
                )
            else:
                made_today = await conn.fetchval(
                    "select count(*) from immersive_world "
                    "where family_id = $1 and created_at > now() - interval '1 day'",
                    family_id,
                )
                if made_today >= s.immersive_daily_limit_per_family:
                    raise HTTPException(
                        status.HTTP_429_TOO_MANY_REQUESTS,
                        "Your family made the most worlds for today. Try again tomorrow.",
                    )
                world_id = await conn.fetchval(
                    "insert into immersive_world (family_id, heirloom_id, source_media_id, "
                    "story_id, requested_by, requested_by_person, model) "
                    "values ($1, $2, $3, $4, $5, $6, $7) returning id",
                    family_id,
                    heirloom_id,
                    media_id,
                    story_id,
                    user.id,
                    person_id,
                    s.worldlabs_model,
                )
            await enqueue(conn, "immersive_world", world_id, family_id)
    response.status_code = status.HTTP_202_ACCEPTED
    return WorldSummary(
        id=world_id, source_media_id=media_id, status="queued", updated_at=datetime.now(UTC)
    )


class ImmersivePhoto(BaseModel):
    media_id: UUID
    is_cover: bool
    world: WorldSummary | None


_PHOTOS = f"""
select m.id as media_id, m.id = h.cover_media_id as is_cover,
       w.id, w.source_media_id, {_STATUS} as status, w.assets, w.updated_at
from media m
join heirloom h on h.id = m.heirloom_id
left join immersive_world w on w.source_media_id = m.id
{_JOB}
where m.heirloom_id = $1 and m.kind in ('photo', 'scan')
"""


async def _photos(rows: list[asyncpg.Record]) -> list[ImmersivePhoto]:
    return [
        ImmersivePhoto(
            media_id=r["media_id"],
            is_cover=bool(r["is_cover"]),
            world=await _summary(r) if r["id"] else None,
        )
        for r in rows
    ]


@router.get("/heirlooms/{heirloom_id}/immersive")
async def list_worlds(heirloom_id: UUID, user: CurrentUser) -> list[ImmersivePhoto]:
    """Each photo of the story that can become a world, and its world if one was asked for."""
    _enabled()
    async with pool().acquire() as conn:
        await require_member(conn, user, await family_of_heirloom(conn, heirloom_id))
        rows = await conn.fetch(_PHOTOS + "order by is_cover desc, m.created_at", heirloom_id)
    return await _photos(rows)


@router.get("/public/heirlooms/{heirloom_id}/immersive")
async def list_public_worlds(heirloom_id: UUID, k: str) -> list[ImmersivePhoto]:
    """Only finished worlds, for anyone holding the family's story link."""
    _enabled()
    async with pool().acquire() as conn:
        rows = await conn.fetch(
            _PHOTOS + "and w.status = 'ready' and exists (select 1 from family f "
            "where f.id = h.family_id and f.invite_code = $2) "
            "order by is_cover desc, m.created_at",
            heirloom_id,
            k,
        )
    return await _photos(rows)


async def _resolve(conn: asyncpg.Connection, w: asyncpg.Record) -> ImmersiveWorld:
    spots = [Hotspot(**h) for h in w["hotspots"]]
    fact_ids = list({i for s in spots for i in s.fact_ids})
    segment_ids = list({i for s in spots for i in s.segment_ids})
    facts = {
        f["id"]: f["text"]
        for f in await conn.fetch(
            "select id, text from fact where id = any($1) and heirloom_id = $2",
            fact_ids,
            w["heirloom_id"],
        )
    }
    segments = await conn.fetch(
        """
        select s.id, s.text, s.text_en, s.start_ms, s.end_ms, i.narrator_id, m.storage_path
        from segment s
        join turn t on t.id = s.turn_id
        join interview i on i.id = t.interview_id
        join media m on m.id = t.audio_media_id
        where s.id = any($1) and i.heirloom_id = $2
        """,
        segment_ids,
        w["heirloom_id"],
    )
    audio = {
        p: await storage.signed_download_url("audio", p)
        for p in {s["storage_path"] for s in segments}
    }
    clips = {
        s["id"]: ResolvedSegment(
            id=s["id"],
            text=s["text"],
            text_en=s["text_en"],
            start_ms=s["start_ms"],
            end_ms=s["end_ms"],
            speaker_id=s["narrator_id"],
            audio_url=audio[s["storage_path"]],
        )
        for s in segments
    }
    assets: dict[str, Any] = w["assets"] or {}
    narrator = w["narrator"]
    ref = ReferencePhoto(**w["reference"]) if w["reference"] else None
    return ImmersiveWorld(
        id=w["id"],
        heirloom_id=w["heirloom_id"],
        story_id=w["story_id"],
        status=w["status"],
        error=w["error"],
        narrator=narrator,
        label=f"Imagined from {narrator or 'the storyteller'}'s words, not a photograph",
        assets={k: await storage.signed_download_url("generated", p) for k, p in assets.items()},
        semantics=w["semantics"] or {},
        spots=[
            ResolvedSpot(
                id=s.id,
                label=s.label,
                u=s.u,
                v=s.v,
                facts=[SpotFact(id=i, text=facts[i]) for i in s.fact_ids if i in facts],
                segments=[clips[i] for i in s.segment_ids if i in clips],
            )
            for s in spots
        ],
        reference=ReferenceCredit(
            title=ref.title,
            page_url=ref.page_url,
            kind="generated" if ref.via == "generated" else "web",
        )
        if ref
        else None,
    )


_WORLD = f"""
select w.id, w.family_id, w.heirloom_id, w.story_id, {_STATUS} as status,
       coalesce(w.error, j.error) as error, w.assets, w.semantics, w.hotspots, w.reference,
       (select p.display_name from interview i join person p on p.id = i.narrator_id
         where i.heirloom_id = w.heirloom_id order by i.created_at limit 1) as narrator
from immersive_world w
{_JOB}
"""


@router.get("/immersive/{world_id}")
async def get_world(world_id: UUID, user: CurrentUser) -> ImmersiveWorld:
    _enabled()
    async with pool().acquire() as conn:
        w = await conn.fetchrow(_WORLD + "where w.id = $1", world_id)
        if w is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "world not found")
        await require_member(conn, user, w["family_id"])
        return await _resolve(conn, w)


@router.get("/public/immersive/{world_id}")
async def get_public_world(world_id: UUID, k: str) -> ImmersiveWorld:
    _enabled()
    async with pool().acquire() as conn:
        w = await conn.fetchrow(
            _WORLD + "join family f on f.id = w.family_id "
            "where w.id = $1 and f.invite_code = $2 and w.status = 'ready'",
            world_id,
            k,
        )
        if w is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "world not found")
        return await _resolve(conn, w)
