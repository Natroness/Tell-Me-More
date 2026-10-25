"""End-to-end run of the whole pipeline against the configured (hosted) project.

Photo -> stages 1-2 -> a spoken interview (Muse plays the narrator, macOS `say` speaks the
answers) -> stages 3-4 per answer -> finish -> stages 5-8. The real job worker runs in-process.

Answers stream through the real WebSocket handler (routers/answer_stream.py) at microphone pace;
`--batch` uploads them for transcribe_turn instead. The script has no Supabase login, so it skips
only the membership check there; auth is covered by tests and a forged-token probe.

Streamed answers end like the app ends them: after `--silence` seconds of quiet (default 2.0, the
app's END_SILENCE_MS). The next question comes back on the socket; its latency is reported from
the end of speech and from the moment the answer ended.

Run:     uv run python -m scripts.e2e_pipeline [--answers 3] [--batch] [--silence 2.0]
Cleanup: uv run python -m scripts.e2e_pipeline --cleanup <family_id>
"""

import argparse
import asyncio
import io
import json
import tempfile
import time
import wave
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import httpx
from pydantic import BaseModel

from app import db, storage
from app.config import get_settings
from app.jobs.queue import enqueue
from app.jobs.runner import run_worker
from app.jobs.stages.common import sniff_image_mime
from app.providers import get_providers
from app.routers import answer_stream
from scripts.check_services import _spoken_wav

PERSONA = """You are Sita, 84, a grandmother in Austin, speaking to your granddaughter about your
gold pocket watch. Facts you know: it belonged to your father Hari, a schoolteacher in
Kathmandu. He bought it in 1952 with a year of savings. He gave it to you in 1968 when you left
Nepal for Texas, saying "so you always know what time it is at home". It stopped once in 1990
and a watchmaker on Congress Avenue fixed it. You wind it every Sunday. You want your
granddaughter Maya to have it. Answer in 2 to 4 short spoken sentences, warm and plain."""

PHOTO_PROMPT = (
    "A realistic photo of an antique gold pocket watch with an engraved lid and a worn chain, "
    "resting on an old embroidered cloth, soft daylight"
)


class Answer(BaseModel):
    answer: str


class MicSocket:
    """Plays a WAV into stream_answer the way the phone does: 80 ms PCM frames in real time, then
    `silence_s` of quiet, then `end`. Records what the server sends back and when."""

    FRAME_BYTES = 16_000 * 2 * 80 // 1000

    def __init__(self, wav: bytes, silence_s: float = 0) -> None:
        with wave.open(io.BytesIO(wav)) as w:
            speech = w.readframes(w.getnframes())
        self.speech_s = len(speech) / 32_000
        self.pcm = speech + bytes(int(silence_s * 32_000) // 2 * 2)
        self.offset = 0
        self.started: float | None = None
        self.sent: list[tuple[float, dict]] = []
        self.ended_at: float | None = None
        self.hello = False

    async def accept(self) -> None:
        pass

    async def receive_json(self) -> dict:
        self.hello = True
        return {"type": "start", "token": "e2e"}

    async def receive(self) -> dict:
        self.started = self.started or time.perf_counter()
        if self.offset >= len(self.pcm):
            self.ended_at = time.perf_counter()
            return {"type": "websocket.receive", "text": json.dumps({"type": "end"})}
        due = self.started + self.offset / 32_000 - time.perf_counter()
        if due > 0:
            await asyncio.sleep(due)
        frame = self.pcm[self.offset : self.offset + self.FRAME_BYTES]
        self.offset += len(frame)
        return {"type": "websocket.receive", "bytes": frame}

    async def send_json(self, data: dict) -> None:
        self.sent.append((time.perf_counter(), data))

    async def close(self, code: int = 1000) -> None:
        pass


def say(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


async def wait_for(what: str, check: Callable[[], Awaitable[Any]], limit_s: float = 300) -> Any:
    start = time.perf_counter()
    async with asyncio.timeout(limit_s):
        while not (value := await check()):  # noqa: ASYNC110 (polling the database)
            await asyncio.sleep(1)
    say(f"  {what} ({time.perf_counter() - start:.1f}s)")
    return value


async def job_failed(conn, family_id: UUID) -> None:
    failed = await conn.fetch(
        "select kind, error from job where family_id = $1 and status = 'failed'", family_id
    )
    if failed:
        raise RuntimeError(f"jobs failed: {[(f['kind'], f['error']) for f in failed]}")


async def run(n_answers: int, batch: bool, silence_s: float, storytime: bool = False) -> None:
    p = get_providers()
    family_id, narrator_id, heirloom_id, photo_id = uuid4(), uuid4(), uuid4(), uuid4()
    user_id = uuid4()  # stages never check membership; no auth user is created
    started = time.perf_counter()

    async with db.pool().acquire() as conn:
        await conn.execute(
            "insert into family (id, name, invite_code) values ($1, 'E2E test family', $2)",
            family_id,
            f"e2e-{family_id.hex[:12]}",
        )
        await conn.execute(
            "insert into person (id, family_id, display_name, relation_label) "
            "values ($1, $2, 'Sita', 'grandmother')",
            narrator_id,
            family_id,
        )
        await conn.execute(
            "insert into person (family_id, display_name, relation_label, is_living) values "
            "($1, 'Hari', 'great-grandfather', false), ($1, 'Maya', 'granddaughter', true)",
            family_id,
        )
        await conn.execute(
            "insert into heirloom (id, family_id, created_by) values ($1, $2, $3)",
            heirloom_id,
            family_id,
            user_id,
        )
    say(f"family {family_id}, heirloom {heirloom_id}")

    say("photo: generating with Muse Image")
    image = await p.image.generate(PHOTO_PROMPT)
    mime = sniff_image_mime(image)
    path = storage.object_path(family_id, heirloom_id, photo_id, mime)
    await storage.upload("photos", path, image, mime)
    async with db.pool().acquire() as conn, conn.transaction():
        await conn.execute(
            "insert into media (id, family_id, heirloom_id, kind, storage_path, mime) "
            "values ($1, $2, $3, 'photo', $4, $5)",
            photo_id,
            family_id,
            heirloom_id,
            path,
            mime,
        )
        await conn.execute(
            "update heirloom set cover_media_id = $2 where id = $1", heirloom_id, photo_id
        )
        await enqueue(conn, "analyze_object", heirloom_id, family_id)
        await enqueue(conn, "lens_lookup", heirloom_id, family_id)

    async with db.pool().acquire() as conn:

        async def jobs_done(*kinds: str) -> bool:
            await job_failed(conn, family_id)
            n = await conn.fetchval(
                "select count(*) from job where subject_id = $1 and kind = any($2) "
                "and status = 'done'",
                heirloom_id,
                list(kinds),
            )
            return n == len(kinds)

        await wait_for(
            "stages 1-2 done (vision + lens)", lambda: jobs_done("analyze_object", "lens_lookup")
        )
        reading = await conn.fetchval(
            "select output from job where kind = 'analyze_object' and subject_id = $1", heirloom_id
        )
        facts = await conn.fetch(
            "select text, source->>'via' as via from fact where heirloom_id = $1", heirloom_id
        )
        say(f"  title={reading['suggested_title']!r} category={reading['category']}")
        for f in facts:
            say(f"  observation ({f['via']}): {f['text']}")

        interview_id = uuid4()
        await conn.execute(
            "insert into interview (id, heirloom_id, narrator_id, interviewer_user_id, state) "
            "values ($1, $2, $3, $4, 'asking')",
            interview_id,
            heirloom_id,
            narrator_id,
            user_id,
        )
        await conn.execute(
            "insert into turn (interview_id, idx, role, text) values ($1, 0, 'question', $2)",
            interview_id,
            reading["seed_questions"][0],
        )

        history: list[dict] = []
        for n in range(n_answers):
            question = await conn.fetchval(
                "select text from turn where interview_id = $1 and role = 'question' "
                "order by idx desc limit 1",
                interview_id,
            )
            say(f"Q{n + 1}: {question}")
            history.append({"role": "user", "content": question})
            reply = await p.llm.json(system=PERSONA, messages=history, schema=Answer)
            history.append({"role": "assistant", "content": reply.answer})
            say(f"A{n + 1} (spoken by `say`): {reply.answer}")

            audio = await asyncio.to_thread(_spoken_wav, reply.answer)
            media_id, turn_id = uuid4(), uuid4()
            apath = storage.object_path(family_id, heirloom_id, media_id, "audio/wav")
            if batch:
                await storage.upload("audio", apath, audio, "audio/wav")
            answered = time.perf_counter()
            async with conn.transaction():
                await conn.execute(
                    "insert into media (id, family_id, heirloom_id, kind, storage_path, mime) "
                    "values ($1, $2, $3, 'audio', $4, 'audio/wav')",
                    media_id,
                    family_id,
                    heirloom_id,
                    apath,
                )
                await conn.execute(
                    "insert into turn (id, interview_id, idx, role, audio_media_id) "
                    "select $1, $2, max(idx) + 1, 'answer', $3 from turn where interview_id = $2",
                    turn_id,
                    interview_id,
                    media_id,
                )
                await conn.execute(
                    "update interview set state = $2 where id = $1",
                    interview_id,
                    "thinking" if batch else "listening",
                )
                if batch:
                    await enqueue(conn, "transcribe_turn", turn_id, family_id)
            if not batch:
                mic = MicSocket(audio, silence_s)
                await answer_stream.stream_answer(mic, interview_id, turn_id)
                partials = sum(d["type"] == "partial" for _, d in mic.sent)
                done = next(((t, d) for t, d in mic.sent if d["type"] == "done"), None)
                if done is None:
                    raise RuntimeError(f"stream did not finish: {mic.sent[-3:]}")
                done_at, reply_msg = done
                speech_end = mic.started + mic.speech_s
                say(
                    f"  streamed {mic.speech_s:.1f}s of speech + {silence_s:.1f}s quiet, "
                    f"{partials} live captions"
                )
                say(
                    f"  next question {done_at - mic.ended_at:.2f}s after the answer ended, "
                    f"{done_at - speech_end:.2f}s after they stopped talking: "
                    f"{(reply_msg['question'] or {}).get('text')!r}"
                )
                heard = await conn.fetchval("select text from turn where id = $1", turn_id)
                say(f"  ASR heard: {heard}")
                if reply_msg["ended"]:
                    say("  the interview ended itself")
                    break
                continue

            async def asking() -> bool:
                await job_failed(conn, family_id)
                return (
                    await conn.fetchval("select state from interview where id = $1", interview_id)
                    == "asking"
                )

            await wait_for("transcribed + next question ready", asking, limit_s=180)
            heard = await conn.fetchval("select text from turn where id = $1", turn_id)
            segs = await conn.fetchval("select count(*) from segment where turn_id = $1", turn_id)
            say(f"  ASR heard ({segs} segments): {heard}")
            say(f"  answer-to-next-question latency: {time.perf_counter() - answered:.1f}s")

        say("finish interview")
        async with conn.transaction():
            await conn.execute(
                "update interview set state = 'wrapping_up', ended_at = now() where id = $1",
                interview_id,
            )
            await enqueue(conn, "extract_facts", heirloom_id, family_id)
        finished = time.perf_counter()
        await wait_for(
            "stages 5-7 done (facts, era, story)",
            lambda: jobs_done("extract_facts", "era_context", "compose_story"),
            limit_s=600,
        )
        say(f"  finish-to-story latency: {time.perf_counter() - finished:.1f}s")
        await wait_for("stage 8 done (cover)", lambda: jobs_done("cover_art"), limit_s=300)

        await report(conn, heirloom_id, interview_id)
    if storytime:
        await render_storytime(family_id, heirloom_id, user_id)
    say(
        f"total {time.perf_counter() - started:.0f}s. Clean up: "
        f"uv run python -m scripts.e2e_pipeline --cleanup {family_id}"
    )


async def render_storytime(family_id: UUID, heirloom_id: UUID, user_id: UUID) -> None:
    """Explicit opt-in diagnostic, restricted to the synthetic E2E family."""
    attempt_id = uuid4()
    async with db.pool().acquire() as conn, conn.transaction():
        if (
            await conn.fetchval("select name from family where id=$1", family_id)
            != "E2E test family"
        ):
            raise ValueError("Storytime diagnostic requires a synthetic E2E family")
        story_id = await conn.fetchval(
            "select id from story where heirloom_id=$1 and status='published' "
            "order by version desc limit 1",
            heirloom_id,
        )
        st_id = await conn.fetchval(
            "insert into storytime(family_id,heirloom_id,story_id,requested_by,generation_id) "
            "values($1,$2,$3,$4,$5) returning id",
            family_id,
            heirloom_id,
            story_id,
            user_id,
            attempt_id,
        )
        await conn.execute(
            "insert into storytime_attempt(id,family_id,heirloom_id,storytime_id,requested_by) "
            "values($1,$2,$3,$4,$5)",
            attempt_id,
            family_id,
            heirloom_id,
            st_id,
            user_id,
        )
        await enqueue(conn, "storytime_script", attempt_id, family_id)
    last_status = None
    last_time = time.perf_counter()

    async def ready():
        nonlocal last_status, last_time
        async with db.pool().acquire() as conn:
            row = await conn.fetchrow(
                "select status,error,duration_ms from storytime where id=$1", st_id
            )
        if row["status"] != last_status:
            now = time.perf_counter()
            say(
                f"storytime: {last_status or 'queued'} took {now - last_time:.1f}s; "
                f"now {row['status']}"
            )
            last_status, last_time = row["status"], now
        if row["status"] == "failed":
            raise RuntimeError(f"Storytime failed: {row['error']}")
        return row if row["status"] == "ready" else None

    row = await wait_for("Storytime MP4 ready", ready, limit_s=900)
    say(f"storytime: duration {row['duration_ms'] / 1000:.1f}s")


async def report(conn, heirloom_id: UUID, interview_id: UUID) -> None:
    facts = {
        f["id"]: f
        for f in await conn.fetch(
            "select id, kind, text, year, place from fact where heirloom_id = $1", heirloom_id
        )
    }
    segments = {
        s["id"]: s["text"]
        for s in await conn.fetch(
            "select s.id, s.text from segment s join turn t on t.id = s.turn_id "
            "where t.interview_id = $1",
            interview_id,
        )
    }
    cards = await conn.fetch(
        "select year, place, topic, summary, sources from context_card where heirloom_id = $1",
        heirloom_id,
    )
    story = await conn.fetchrow(
        "select version, title, dek, blocks from story where heirloom_id = $1 "
        "order by version desc limit 1",
        heirloom_id,
    )
    cover = await conn.fetchrow(
        "select storage_path, mime from media where heirloom_id = $1 and kind = 'generated_image'",
        heirloom_id,
    )
    state = await conn.fetchval("select state from interview where id = $1", interview_id)

    print("\n=== memory facts ===")
    for f in facts.values():
        if f["kind"] == "memory":
            print(f"- {f['text']}  (year={f['year']}, place={f['place']})")
    print("\n=== context cards ===")
    for c in cards:
        print(f"- [{c['topic']} {c['year']} {c['place']}] {c['summary']}")
        print(f"    sources: {[s['url'] for s in c['sources']]}")
    print(f"\n=== story v{story['version']}: {story['title']} ===\n{story['dek']}\n")
    for b in story["blocks"]:
        if b["type"] == "paragraph":
            for s in b["sentences"]:
                cites = [
                    f"seg:{segments[UUID(c['segment_id'])][:30]!r}"
                    if c["kind"] == "segment"
                    else f"{facts[UUID(c['fact_id'])]['kind']}-fact"
                    for c in s["cites"]
                ]
                print(f"  {s['text']}\n      cites {cites}")
        elif b["type"] == "quote":
            print(f'  > "{segments[UUID(b["segment_id"])]}"')
        elif b["type"] == "heading":
            print(f"\n## {b['text']}")
        else:
            print(
                f"  [{b['type']} block] {json.dumps({k: v for k, v in b.items() if k != 'type'})}"
            )
    print(f"\ninterview state: {state}")
    if cover:
        url = await storage.signed_download_url("generated", cover["storage_path"], 3600)
        out = f"{tempfile.gettempdir()}/lorebook_e2e_cover.{cover['mime'].split('/')[1]}"
        async with httpx.AsyncClient(timeout=30) as http:
            data = (await http.get(url)).raise_for_status().content
        await asyncio.to_thread(Path(out).write_bytes, data)
        print(f"cover: {len(data) // 1024} KB, saved to {out}")


async def cleanup(family_id: UUID) -> None:
    async with db.pool().acquire() as conn:
        rows = await conn.fetch(
            "select kind, storage_path from media where family_id = $1", family_id
        )
        name = await conn.fetchval("select name from family where id = $1", family_id)
        if name != "E2E test family":
            raise SystemExit(f"refusing: family {family_id} is {name!r}, not an E2E test family")
        attempts = await conn.fetch(
            "select assets from storytime_attempt where family_id=$1", family_id
        )
    intermediate = {
        v["path"]
        for a in attempts
        for v in a["assets"].values()
        if isinstance(v, dict) and "path" in v
    }
    await storage.remove("generated", sorted(intermediate))
    bucket = {
        "photo": "photos",
        "audio": "audio",
        "generated_image": "generated",
        "generated_video": "generated",
        "generated_audio": "generated",
    }
    s = get_settings()
    async with httpx.AsyncClient(timeout=30) as http:
        for kind, b in bucket.items():
            paths = [r["storage_path"] for r in rows if r["kind"] == kind]
            if paths:
                await http.request(
                    "DELETE",
                    f"{s.supabase_url}/storage/v1/object/{b}",
                    headers={"apikey": s.supabase_secret_key},
                    json={"prefixes": paths},
                )
    async with db.pool().acquire() as conn:
        await conn.execute("delete from job where family_id = $1", family_id)
        # Interviews point at their narrator and turns at their audio without cascading, so
        # interviews go first.
        await conn.execute(
            "delete from interview where heirloom_id in "
            "(select id from heirloom where family_id = $1)",
            family_id,
        )
        await conn.execute("delete from family where id = $1", family_id)
    say(f"deleted family {family_id} and {len(rows)} stored files")


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--answers", type=int, default=3)
    ap.add_argument("--cleanup", type=UUID)
    ap.add_argument("--storytime", action="store_true", help="Also make an English Storytime video")
    ap.add_argument("--batch", action="store_true", help="upload answers instead of streaming")
    ap.add_argument("--silence", type=float, default=2.0, help="quiet that ends an answer")
    args = ap.parse_args()
    await db.open_pool(get_settings().database_url)
    stop = asyncio.Event()
    worker = None
    try:
        if args.cleanup:
            await cleanup(args.cleanup)
            return
        worker = asyncio.create_task(run_worker(stop, concurrency=4))
        if not args.batch:

            async def no_membership_check(conn, user, family_id):
                return None

            answer_stream.require_member = no_membership_check
            answer_stream.user_from_token = lambda token: None
        await run(args.answers, args.batch, args.silence, args.storytime)
    finally:
        stop.set()
        if worker:
            await worker
        await db.close_pool()


if __name__ == "__main__":
    asyncio.run(main())
