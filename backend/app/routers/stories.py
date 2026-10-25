"""Story pages. Citations are resolved here so the frontend can play any sentence's audio."""

from uuid import UUID

import asyncpg
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, TypeAdapter

from app.accounts import in_archive
from app.auth import CurrentUser, family_of_heirloom, require_member
from app.db import pool
from app.models import Fact, StoryBlock
from app.storage import signed_download_url

router = APIRouter(prefix="/api", tags=["stories"])

_blocks = TypeAdapter(list[StoryBlock])


class ResolvedSegment(BaseModel):
    id: UUID
    text: str
    text_en: str | None
    start_ms: int
    end_ms: int
    speaker_id: UUID
    audio_url: str


class ContextCard(BaseModel):
    id: UUID
    year: int
    place: str | None
    topic: str
    summary: str
    sources: list[dict]


class Recording(BaseModel):
    """One answer, whole. Played in order, these are the story told in the teller's own voice."""

    turn_id: UUID
    audio_url: str
    duration_ms: int | None
    speaker_id: UUID
    question: str | None


class Story(BaseModel):
    heirloom_id: UUID
    version: int
    title: str
    dek: str | None
    blocks: list[StoryBlock]
    segments: dict[UUID, ResolvedSegment]
    facts: dict[UUID, Fact]
    context_cards: dict[UUID, ContextCard]
    recordings: list[Recording]
    people: dict[UUID, str]
    photos: dict[UUID, str]
    memories: dict[UUID, str]


async def _load_story(conn: asyncpg.Connection, heirloom_id: UUID) -> Story:
    story = await conn.fetchrow(
        "select version, title, dek, blocks from story where heirloom_id = $1 "
        "order by version desc limit 1",
        heirloom_id,
    )
    if story is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no story yet")
    segments = await conn.fetch(
        """
        select s.id, s.text, s.text_en, s.start_ms, s.end_ms, i.narrator_id, m.storage_path
        from segment s
        join turn t on t.id = s.turn_id
        join interview i on i.id = t.interview_id
        join media m on m.id = t.audio_media_id
        where i.heirloom_id = $1
        """,
        heirloom_id,
    )
    facts = await conn.fetch(
        "select id, heirloom_id, kind, text, source, year, place, people, confidence "
        "from fact where heirloom_id = $1",
        heirloom_id,
    )
    cards = await conn.fetch(
        "select id, year, place, topic, summary, sources from context_card where heirloom_id = $1",
        heirloom_id,
    )
    recordings = await conn.fetch(
        """
        select t.id, i.narrator_id, m.storage_path, m.duration_ms,
               (select q.text from turn q where q.interview_id = t.interview_id
                 and q.role = 'question' and q.idx < t.idx order by q.idx desc limit 1) as question
        from turn t
        join interview i on i.id = t.interview_id
        join media m on m.id = t.audio_media_id
        where i.heirloom_id = $1 and t.role = 'answer'
          and exists (select 1 from segment s where s.turn_id = t.id)
        order by i.created_at, t.idx
        """,
        heirloom_id,
    )
    people = await conn.fetch(
        "select p.id, p.display_name from person p join heirloom h on h.family_id = p.family_id "
        "where h.id = $1",
        heirloom_id,
    )
    photos = await conn.fetch(
        "select id, kind, storage_path from media "
        "where heirloom_id = $1 and kind in ('photo', 'scan', 'generated_image') "
        "and storage_path not like '%/storytime/%'",
        heirloom_id,
    )
    memories = await conn.fetch(
        "select id, text from memory_note where heirloom_id = $1 and text is not null",
        heirloom_id,
    )
    paths = {s["storage_path"] for s in segments} | {r["storage_path"] for r in recordings}
    audio_urls = {p: await signed_download_url("audio", p) for p in paths}
    return Story(
        heirloom_id=heirloom_id,
        version=story["version"],
        title=story["title"],
        dek=story["dek"],
        blocks=_blocks.validate_python(story["blocks"]),
        segments={
            s["id"]: ResolvedSegment(
                id=s["id"],
                text=s["text"],
                text_en=s["text_en"],
                start_ms=s["start_ms"],
                end_ms=s["end_ms"],
                speaker_id=s["narrator_id"],
                audio_url=audio_urls[s["storage_path"]],
            )
            for s in segments
        },
        facts={f["id"]: Fact(**f) for f in facts},
        context_cards={c["id"]: ContextCard(**c) for c in cards},
        recordings=[
            Recording(
                turn_id=r["id"],
                audio_url=audio_urls[r["storage_path"]],
                duration_ms=r["duration_ms"],
                speaker_id=r["narrator_id"],
                question=r["question"],
            )
            for r in recordings
        ],
        people={p["id"]: p["display_name"] for p in people},
        photos={
            m["id"]: await signed_download_url(
                "generated" if m["kind"] == "generated_image" else "photos", m["storage_path"]
            )
            for m in photos
        },
        memories={m["id"]: m["text"] for m in memories},
    )


@router.get("/stories/{heirloom_id}")
async def get_story(heirloom_id: UUID, user: CurrentUser) -> Story:
    async with pool().acquire() as conn:
        await require_member(conn, user, await family_of_heirloom(conn, heirloom_id))
        return await _load_story(conn, heirloom_id)


@router.get("/public/stories/{heirloom_id}")
async def get_public_story(heirloom_id: UUID, k: str) -> Story:
    async with pool().acquire() as conn:
        ok = await conn.fetchval(
            "select 1 from heirloom h join family f on f.id = h.family_id "
            "where h.id = $1 and f.invite_code = $2",
            heirloom_id,
            k,
        )
        if not ok:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "story not found")
        return await _load_story(conn, heirloom_id)


class ArchiveStory(BaseModel):
    heirloom_id: UUID
    version: int
    title: str
    dek: str | None = None
    object_title: str | None = None
    cover_url: str | None = None
    storyteller_name: str | None = None
    created_at: str


@router.get("/archive")
async def archive(user: CurrentUser, user_id: UUID | None = None) -> list[ArchiveStory]:
    """Someone's stories, newest first: objects they photographed or told. Yours by default.

    Another person's archive opens only once you're connected, and shows only what you can open.
    """
    owner = user_id or user.id
    async with pool().acquire() as conn:
        if owner != user.id and not await conn.fetchval(
            "select 1 from connection where user_id = $1 and other_id = $2", user.id, owner
        ):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "not connected")
        rows = await conn.fetch(
            f"""
            select s.heirloom_id, s.version, s.title, s.dek, s.created_at::text,
                   h.title as object_title, cm.storage_path as cover_path,
                   (select p.display_name from interview i join person p on p.id = i.narrator_id
                     where i.heirloom_id = h.id order by i.created_at desc limit 1)
                     as storyteller_name
            from heirloom h
            join lateral (select * from story where heirloom_id = h.id
                          order by version desc limit 1) s on true
            left join media cm on cm.id = h.cover_media_id
            where {in_archive("$1", "$2")}
            order by s.created_at desc
            """,
            owner,
            user.id,
        )
    return [
        ArchiveStory(
            **{k: v for k, v in r.items() if k != "cover_path"},
            cover_url=(
                await signed_download_url("photos", r["cover_path"]) if r["cover_path"] else None
            ),
        )
        for r in rows
    ]
