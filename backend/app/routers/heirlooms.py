from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.auth import CurrentUser, family_of_heirloom, require_member
from app.db import pool
from app.jobs.queue import enqueue
from app.models import Fact, HeirloomCategory
from app.storage import object_path, signed_download_url, signed_upload_url

router = APIRouter(prefix="/api/heirlooms", tags=["heirlooms"])


class Heirloom(BaseModel):
    id: UUID
    family_id: UUID
    title: str | None
    category: HeirloomCategory | None
    cover_url: str | None = None


class HeirloomDetail(BaseModel):
    heirloom: Heirloom
    observations: list[Fact]
    seed_questions: list[str]
    latest_story_version: int | None


class CreateHeirloom(BaseModel):
    family_id: UUID
    photo_mime: str


class CreatedHeirloom(BaseModel):
    heirloom_id: UUID
    media_id: UUID
    upload_url: str


async def _cover_url(path: str | None) -> str | None:
    return await signed_download_url("photos", path) if path else None


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_heirloom(body: CreateHeirloom, user: CurrentUser) -> CreatedHeirloom:
    heirloom_id, media_id = uuid4(), uuid4()
    path = object_path(body.family_id, heirloom_id, media_id, body.photo_mime)
    async with pool().acquire() as conn:
        await require_member(conn, user, body.family_id)
        async with conn.transaction():
            await conn.execute(
                "insert into heirloom (id, family_id, created_by) values ($1, $2, $3)",
                heirloom_id,
                body.family_id,
                user.id,
            )
            await conn.execute(
                "insert into media (id, family_id, heirloom_id, kind, storage_path, mime, "
                "created_by) values ($1, $2, $3, 'photo', $4, $5, $6)",
                media_id,
                body.family_id,
                heirloom_id,
                path,
                body.photo_mime,
                user.id,
            )
    return CreatedHeirloom(
        heirloom_id=heirloom_id,
        media_id=media_id,
        upload_url=await signed_upload_url("photos", path),
    )


@router.post("/{heirloom_id}/photos/{media_id}/complete", status_code=status.HTTP_202_ACCEPTED)
async def photo_uploaded(heirloom_id: UUID, media_id: UUID, user: CurrentUser) -> None:
    async with pool().acquire() as conn:
        family_id = await family_of_heirloom(conn, heirloom_id)
        await require_member(conn, user, family_id)
        async with conn.transaction():
            await conn.execute(
                "update heirloom set cover_media_id = coalesce(cover_media_id, $2) where id = $1",
                heirloom_id,
                media_id,
            )
            await enqueue(conn, "analyze_object", heirloom_id, family_id)
            await enqueue(conn, "lens_lookup", heirloom_id, family_id)


@router.get("")
async def list_heirlooms(family_id: UUID, user: CurrentUser) -> list[Heirloom]:
    async with pool().acquire() as conn:
        await require_member(conn, user, family_id)
        rows = await conn.fetch(
            "select h.id, h.family_id, h.title, h.category, m.storage_path from heirloom h "
            "left join media m on m.id = h.cover_media_id "
            "where h.family_id = $1 order by h.created_at desc",
            family_id,
        )
    return [
        Heirloom(
            id=r["id"],
            family_id=r["family_id"],
            title=r["title"],
            category=r["category"],
            cover_url=await _cover_url(r["storage_path"]),
        )
        for r in rows
    ]


@router.get("/{heirloom_id}")
async def get_heirloom(heirloom_id: UUID, user: CurrentUser) -> HeirloomDetail:
    async with pool().acquire() as conn:
        family_id = await family_of_heirloom(conn, heirloom_id)
        await require_member(conn, user, family_id)
        h = await conn.fetchrow(
            "select h.id, h.family_id, h.title, h.category, m.storage_path from heirloom h "
            "left join media m on m.id = h.cover_media_id where h.id = $1",
            heirloom_id,
        )
        if h is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "heirloom not found")
        facts = await conn.fetch(
            "select id, heirloom_id, kind, text, source, year, place, people, confidence "
            "from fact where heirloom_id = $1 and kind = 'observation' order by created_at",
            heirloom_id,
        )
        reading = await conn.fetchval(
            "select output from job where kind = 'analyze_object' and subject_id = $1 "
            "and status = 'done'",
            heirloom_id,
        )
        version = await conn.fetchval(
            "select max(version) from story where heirloom_id = $1", heirloom_id
        )
    return HeirloomDetail(
        heirloom=Heirloom(
            id=h["id"],
            family_id=h["family_id"],
            title=h["title"],
            category=h["category"],
            cover_url=await _cover_url(h["storage_path"]),
        ),
        observations=[Fact(**f) for f in facts],
        seed_questions=(reading or {}).get("seed_questions", []),
        latest_story_version=version,
    )
