"""Published story + its sources -> cited English storyboard. Slow lane only."""

import json
from uuid import UUID

from pydantic import ValidationError

from app import providers
from app.config import get_settings
from app.db import pool
from app.jobs.queue import enqueue
from app.models import Storyboard
from app.prompts import prompt
from app.storytime.common import Superseded, current, load_story, update
from app.storytime.validation import validate


async def run(attempt_id: UUID) -> None:
    row = await current(attempt_id)
    if row is None or row["storyboard"] is not None or row["status"] == "ready":
        return
    try:
        await update(attempt_id, status="scripting")
        async with pool().acquire() as conn:
            story = await load_story(conn, row["story_id"])
            if story is None:
                raise ValueError("The published story is no longer available")
            segments = await conn.fetch(
                "select s.*, t.id as turn_id, t.audio_media_id, i.narrator_id, m.storage_path "
                "from segment s join turn t on t.id = s.turn_id "
                "join interview i on i.id = t.interview_id "
                "join media m on m.id = t.audio_media_id "
                "where i.heirloom_id = $1 and i.language = 'en' and t.role = 'answer' "
                "order by i.created_at, t.idx, s.start_ms",
                row["heirloom_id"],
            )
            facts = await conn.fetch(
                "select * from fact where heirloom_id = $1", row["heirloom_id"]
            )
            photos = await conn.fetch(
                "select id from media where heirloom_id = $1 and kind = 'photo' "
                "and upload_status = 'ready'",
                row["heirloom_id"],
            )
            cards = await conn.fetch(
                "select * from context_card where heirloom_id = $1", row["heirloom_id"]
            )
            notes = await conn.fetch(
                "select id, author_id, text from memory_note where heirloom_id = $1",
                row["heirloom_id"],
            )
            people = await conn.fetch(
                "select id, display_name from person where family_id = $1", row["family_id"]
            )
        known_segments = {s["id"]: dict(s) for s in segments}
        known_facts = {f["id"]: dict(f) for f in facts}
        photo_ids = {p["id"] for p in photos}
        materials = {
            "story": dict(story),
            "segments": [dict(s) for s in segments],
            "facts": [dict(f) for f in facts],
            "photos": [
                {
                    "id": p["id"],
                    "observations": [
                        f["text"] for f in facts if str(f["source"].get("media_id")) == str(p["id"])
                    ],
                }
                for p in photos
            ],
            "context_cards": [dict(c) for c in cards],
            "memory_notes": [dict(n) for n in notes],
            "people": [dict(p) for p in people],
        }
        messages = [{"role": "user", "content": json.dumps(materials, default=str)}]
        board = None
        settings = get_settings()
        for _attempt in range(2):
            try:
                draft = await providers.get_providers().llm.json(
                    system=prompt("storytime_script")
                    + (
                        f"\nConfigured duration target: {settings.storytime_min_seconds:g}–"
                        f"{settings.storytime_max_seconds:g} seconds. "
                        "Short memories may be briefer."
                    ),
                    messages=messages,
                    schema=Storyboard,
                )
                board, problems = validate(
                    draft, known_segments, known_facts, photo_ids, story["narrator_id"]
                )
                messages.append({"role": "assistant", "content": draft.model_dump_json()})
            except ValidationError:
                board = None
                problems = [
                    "Return a valid Storyboard with cited narration and original voice scenes"
                ]
            if not problems:
                break
            messages.append(
                {"role": "user", "content": "Repair these issues: " + "; ".join(problems)}
            )
        if board is None:
            raise ValueError("not enough story yet")
        board.title = story["title"]
        async with pool().acquire() as conn:
            async with conn.transaction():
                saved = await conn.fetchval(
                    "update storytime set storyboard = $2, status = 'gathering', error = null, "
                    "updated_at = now() where generation_id = $1 returning id",
                    attempt_id,
                    board.model_dump(mode="json"),
                )
                if saved:
                    await enqueue(conn, "storytime_render", attempt_id, row["family_id"])
    except Superseded:
        return
    except Exception as exc:
        try:
            await update(
                attempt_id,
                status="failed",
                error="not enough story yet"
                if isinstance(exc, ValueError)
                else "Could not write the video script. Please retry.",
            )
        except Superseded:
            return
        raise
