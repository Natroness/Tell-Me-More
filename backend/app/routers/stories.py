"""Story pages. Citations are resolved here so the frontend can play any sentence's audio."""

from uuid import UUID

import asyncpg
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, TypeAdapter

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


class Story(BaseModel):
    heirloom_id: UUID
    version: int
    title: str
    dek: str | None
    blocks: list[StoryBlock]
    segments: dict[UUID, ResolvedSegment]
    facts: dict[UUID, Fact]
    context_cards: dict[UUID, ContextCard]


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
    audio_urls = {
        p: await signed_download_url("audio", p) for p in {s["storage_path"] for s in segments}
    }
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
