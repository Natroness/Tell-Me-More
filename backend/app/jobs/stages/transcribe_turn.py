"""Stage 3. Answer audio -> turn.text + segment rows, then enqueue next_question.

This is the batch path, used when the phone couldn't stream. The streaming path
(routers/answer_stream.py) shares `answer_context` and `save_answer`, so both end the same way.
"""

from uuid import UUID

import asyncpg

from app import providers, storage
from app.db import pool
from app.jobs.queue import enqueue
from app.providers.base import Blob, TranscriptSegment
from app.segments import sentence_segments, wav_duration_ms


async def answer_context(conn: asyncpg.Connection, turn_id: UUID) -> asyncpg.Record | None:
    """The answer turn with what transcribing it needs, including the family's names to bias
    recognition toward."""
    return await conn.fetchrow(
        """
        select t.interview_id, i.language, h.family_id, h.id as heirloom_id,
               m.id as media_id, m.storage_path, m.mime,
               (select array_agg(distinct n) from person p,
                  unnest(array[p.display_name, p.full_name]) n
                where p.family_id = h.family_id and n is not null) as names
        from turn t
        join interview i on i.id = t.interview_id
        join heirloom h on h.id = i.heirloom_id
        join media m on m.id = t.audio_media_id
        where t.id = $1 and t.role = 'answer'
        """,
        turn_id,
    )


async def save_answer(
    conn: asyncpg.Connection,
    turn_id: UUID,
    ctx: asyncpg.Record,
    text: str,
    segments: list[TranscriptSegment],
    duration_ms: int | None,
    *,
    queue_next: bool = True,
) -> None:
    """queue_next=False when the caller asks the next question itself (the streaming path)."""
    async with conn.transaction():
        await conn.execute("update turn set text = $2 where id = $1", turn_id, text)
        await conn.execute("delete from segment where turn_id = $1", turn_id)
        await conn.executemany(
            "insert into segment (turn_id, start_ms, end_ms, text) values ($1, $2, $3, $4)",
            [(turn_id, s.start_ms, s.end_ms, s.text) for s in segments],
        )
        await conn.execute(
            "update media set duration_ms = $2 where id = $1", ctx["media_id"], duration_ms
        )
        # Never pull a finished interview back into the loop.
        await conn.execute(
            "update interview set state = 'thinking' where id = $1 "
            "and state in ('listening', 'thinking')",
            ctx["interview_id"],
        )
        if queue_next:
            await enqueue(conn, "next_question", ctx["interview_id"], ctx["family_id"])


async def run(turn_id: UUID) -> None:
    async with pool().acquire() as conn:
        ctx = await answer_context(conn, turn_id)
    if ctx is None:
        raise LookupError(f"answer turn {turn_id} with audio not found")

    audio = await storage.download("audio", ctx["storage_path"])
    transcript = await providers.get_providers().asr.transcribe(
        audio=Blob(data=audio, mime=ctx["mime"]), language=ctx["language"], keywords=ctx["names"]
    )
    duration_ms = wav_duration_ms(audio)
    segments = sentence_segments(transcript.segments, transcript.text, duration_ms or 0)

    async with pool().acquire() as conn:
        await save_answer(conn, turn_id, ctx, transcript.text, segments, duration_ms)
