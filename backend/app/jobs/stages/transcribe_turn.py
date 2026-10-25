"""Stage 3. Answer audio -> turn.text + segment rows, then enqueue next_question."""

import io
import re
import wave
from uuid import UUID

from app import providers, storage
from app.db import pool
from app.jobs.queue import enqueue
from app.providers.base import Blob, TranscriptSegment

_SENTENCE_END = re.compile(r"(?<=[.!?।。])\s+")


def wav_duration_ms(audio: bytes) -> int | None:
    try:
        with wave.open(io.BytesIO(audio)) as w:
            return w.getnframes() * 1000 // w.getframerate()
    except (wave.Error, EOFError):
        return None


def estimate_segments(text: str, duration_ms: int) -> list[TranscriptSegment]:
    """One segment per sentence, timed by length. Tap-to-play then lands within a couple of
    seconds of the right spot."""
    sentences = [s for s in _SENTENCE_END.split(text.strip()) if s]
    total = sum(len(s) for s in sentences) or 1
    segments, cursor = [], 0
    for s in sentences:
        end = cursor + duration_ms * len(s) // total
        segments.append(TranscriptSegment(start_ms=cursor, end_ms=end, text=s))
        cursor = end
    return segments


def sentence_segments(
    asr_segments: list[TranscriptSegment], text: str, duration_ms: int
) -> list[TranscriptSegment]:
    """The ASR times whole speech turns, which can hold several sentences. Split each turn into
    sentences within its real time span; with no turns at all, spread the text over the audio."""
    turns = asr_segments or [TranscriptSegment(start_ms=0, end_ms=duration_ms, text=text)]
    return [
        TranscriptSegment(
            start_ms=turn.start_ms + s.start_ms, end_ms=turn.start_ms + s.end_ms, text=s.text
        )
        for turn in turns
        for s in estimate_segments(turn.text, turn.end_ms - turn.start_ms)
    ]


async def run(turn_id: UUID) -> None:
    async with pool().acquire() as conn:
        row = await conn.fetchrow(
            """
            select t.interview_id, i.language, h.family_id, m.id as media_id, m.storage_path, m.mime
            from turn t
            join interview i on i.id = t.interview_id
            join heirloom h on h.id = i.heirloom_id
            join media m on m.id = t.audio_media_id
            where t.id = $1 and t.role = 'answer'
            """,
            turn_id,
        )
    if row is None:
        raise LookupError(f"answer turn {turn_id} with audio not found")

    audio = await storage.download("audio", row["storage_path"])
    transcript = await providers.get_providers().asr.transcribe(
        audio=Blob(data=audio, mime=row["mime"]), language=row["language"]
    )
    duration_ms = wav_duration_ms(audio)
    segments = sentence_segments(transcript.segments, transcript.text, duration_ms or 0)

    async with pool().acquire() as conn, conn.transaction():
        await conn.execute("update turn set text = $2 where id = $1", turn_id, transcript.text)
        await conn.execute("delete from segment where turn_id = $1", turn_id)
        await conn.executemany(
            "insert into segment (turn_id, start_ms, end_ms, text) values ($1, $2, $3, $4)",
            [(turn_id, s.start_ms, s.end_ms, s.text) for s in segments],
        )
        await conn.execute(
            "update media set duration_ms = $2 where id = $1", row["media_id"], duration_ms
        )
        await enqueue(conn, "next_question", row["interview_id"], row["family_id"])
