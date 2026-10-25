"""Stage 7. Facts, segments, cards, photos -> validated StoryDraft -> new story version (§5.4)."""

import json
import logging
from uuid import UUID

import asyncpg

from app import providers
from app.citations import KnownFact, KnownSegment, Sources, check
from app.db import pool
from app.jobs.queue import enqueue
from app.models import StoryDraft
from app.prompts import prompt

log = logging.getLogger(__name__)


async def run(heirloom_id: UUID) -> None:
    async with pool().acquire() as conn:
        heirloom = await conn.fetchrow(
            "select family_id, title, category from heirloom where id = $1", heirloom_id
        )
        segments = await conn.fetch(
            """
            select s.id, s.text, i.narrator_id
            from segment s
            join turn t on t.id = s.turn_id
            join interview i on i.id = t.interview_id
            where i.heirloom_id = $1
            order by i.created_at, t.idx, s.start_ms
            """,
            heirloom_id,
        )
        facts = await conn.fetch(
            "select id, kind, text, year, place from fact where heirloom_id = $1 "
            "order by kind, year nulls last",
            heirloom_id,
        )
        cards = await conn.fetch(
            "select id, year, place, topic, summary from context_card where heirloom_id = $1",
            heirloom_id,
        )
        photos = await conn.fetch(
            "select id from media where heirloom_id = $1 and kind = 'photo' order by created_at",
            heirloom_id,
        )
        notes = await conn.fetch(
            "select id, author_id, text from memory_note where heirloom_id = $1 "
            "order by created_at",
            heirloom_id,
        )
        people = await conn.fetch(
            "select id, display_name, relation_label from person where family_id = $1",
            heirloom["family_id"],
        )

    if not segments and not any(f["kind"] == "memory" for f in facts):
        raise LookupError(f"heirloom {heirloom_id} has no memories to write from yet")

    src = Sources(
        segments={s["id"]: KnownSegment(s["text"], s["narrator_id"]) for s in segments},
        facts={f["id"]: KnownFact(f["text"], f["year"]) for f in facts},
        cards={c["id"] for c in cards},
        photos={p["id"] for p in photos},
        notes={n["id"] for n in notes},
        people={p["id"] for p in people},
    )
    materials = {
        "object": {"title": heirloom["title"], "category": heirloom["category"]},
        "people": [dict(p) for p in people],
        "segments": [dict(s) for s in segments],
        "facts": [dict(f) for f in facts],
        "context_cards": [dict(c) for c in cards],
        "photos": [p["id"] for p in photos],
        "memory_notes": [dict(n) for n in notes],
    }
    messages = [{"role": "user", "content": json.dumps(materials, default=str)}]
    llm = providers.get_providers().llm

    draft = await llm.json(system=prompt("compose_story"), messages=messages, schema=StoryDraft)
    story, problems = check(draft, src)
    if problems:
        messages += [
            {"role": "assistant", "content": draft.model_dump_json()},
            {
                "role": "user",
                "content": "Fix these problems and return the whole story again:\n"
                + "\n".join(f"- {p}" for p in problems),
            },
        ]
        draft = await llm.json(system=prompt("compose_story"), messages=messages, schema=StoryDraft)
        story, problems = check(draft, src)
        if problems:
            log.warning(
                "story %s: dropped %d unsupported pieces: %s", heirloom_id, len(problems), problems
            )
    if all(b.type == "heading" for b in story.blocks):
        raise ValueError(f"story {heirloom_id} has nothing left after validation")

    async with pool().acquire() as conn, conn.transaction():
        saved = await conn.fetchrow(
            "insert into story (heirloom_id, version, title, dek, blocks) "
            "select $1, coalesce(max(version), 0) + 1, $2, $3, $4 from story "
            "where heirloom_id = $1 returning id, version",
            heirloom_id,
            story.title,
            story.dek,
            story.model_dump(mode="json")["blocks"],
        )
        await conn.execute(
            "update interview set state = 'done' where heirloom_id = $1 and state = 'wrapping_up'",
            heirloom_id,
        )
        await _complete_requests(conn, heirloom_id, saved["id"])
        if saved["version"] == 1:
            await enqueue(conn, "cover_art", heirloom_id, heirloom["family_id"])


async def _complete_requests(conn: asyncpg.Connection, heirloom_id: UUID, story_id: UUID) -> None:
    """A finished interview answers its request: mark it completed, tie the story to it, and
    tell the person who asked. Requests already completed stay quiet on later versions."""
    await conn.execute(
        """
        with done as (
          update story_request r set status = 'completed'
          where r.status in ('pending', 'in_progress') and r.id in (
            select request_id from interview
            where heirloom_id = $1 and state = 'done' and request_id is not null
          )
          returning r.id, r.listener_id, r.storyteller_id
        ), tagged as (
          update story set request_id = d.id, storyteller_id = d.storyteller_id
          from (select * from done limit 1) d where story.id = $2
        )
        insert into notification (recipient_id, type, request_id, story_id)
        select listener_id, 'story_ready', id, $2 from done
        """,
        heirloom_id,
        story_id,
    )
