"""Job worker: claims queued rows and runs their stage. See DESIGN.md §5.1."""

import asyncio
import contextlib
import logging
from collections.abc import Awaitable, Callable
from uuid import UUID

import asyncpg

from app.config import get_settings
from app.db import pool
from app.jobs.queue import SLOW_KINDS, JobKind
from app.jobs.stages import (
    analyze_object,
    compose_story,
    cover_art,
    era_context,
    extract_facts,
    immersive_world,
    lens_lookup,
    next_question,
    storytime_render,
    storytime_script,
    transcribe_turn,
    update_coverage,
)

log = logging.getLogger(__name__)

HANDLERS: dict[JobKind, Callable[[UUID], Awaitable[None]]] = {
    "analyze_object": analyze_object.run,
    "lens_lookup": lens_lookup.run,
    "transcribe_turn": transcribe_turn.run,
    "next_question": next_question.run,
    "update_coverage": update_coverage.run,
    "extract_facts": extract_facts.run,
    "era_context": era_context.run,
    "compose_story": compose_story.run,
    "cover_art": cover_art.run,
    "immersive_world": immersive_world.run,
    "storytime_script": storytime_script.run,
    "storytime_render": storytime_render.run,
}

MAX_ATTEMPTS = 3
POLL_SECONDS = 0.25  # each pipeline hop waits up to this long; interviews have two per answer
SLOW_POLL_SECONDS = 2.0


async def _claim(conn: asyncpg.Connection, kinds: list[str]) -> asyncpg.Record | None:
    """The oldest queued job of these kinds. A worker never takes a kind it has no stage for, so
    one running older code leaves newer jobs for a worker that can run them."""
    return await conn.fetchrow(
        """
        update job set status = 'running', attempts = attempts + 1, updated_at = now()
        where id = (
          select id from job where status = 'queued' and kind = any($1::text[])
          order by created_at for update skip locked limit 1
        )
        returning id, kind, subject_id, attempts
        """,
        kinds,
    )


async def _execute(job: asyncpg.Record) -> None:
    try:
        await HANDLERS[job["kind"]](job["subject_id"])
    except Exception as e:
        log.exception("job %s %s failed", job["kind"], job["subject_id"])
        retry = job["attempts"] < MAX_ATTEMPTS
        async with pool().acquire() as conn:
            await conn.execute(
                "update job set status = $2, error = $3, updated_at = now() "
                "where id = $1 and status = 'running'",
                job["id"],
                "queued" if retry else "failed",
                repr(e),
            )
        return
    # A re-enqueue while running flipped the row back to 'queued'; leave it so it runs again.
    async with pool().acquire() as conn:
        await conn.execute(
            "update job set status = 'done', updated_at = now() "
            "where id = $1 and status = 'running'",
            job["id"],
        )


async def run_worker(stop: asyncio.Event, concurrency: int) -> None:
    async with pool().acquire() as conn:
        await conn.execute("update job set status = 'queued' where status = 'running'")
    fast = [k for k in HANDLERS if k not in SLOW_KINDS]
    slow = [k for k in HANDLERS if k in SLOW_KINDS]
    await asyncio.gather(
        _lane(stop, concurrency, fast, poll=POLL_SECONDS),
        _lane(stop, get_settings().immersive_concurrency, slow, poll=SLOW_POLL_SECONDS),
    )


async def _lane(stop: asyncio.Event, concurrency: int, kinds: list[str], *, poll: float) -> None:
    slots = asyncio.Semaphore(concurrency)
    running: set[asyncio.Task] = set()

    async def guarded(job: asyncpg.Record) -> None:
        try:
            await _execute(job)
        finally:
            slots.release()

    while not stop.is_set():
        await slots.acquire()
        try:
            async with pool().acquire() as conn:
                job = await _claim(conn, kinds)
        except (OSError, asyncpg.PostgresError):
            log.exception("claiming a job failed; retrying")
            job = None
        if job is None:
            slots.release()
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(stop.wait(), poll)
            continue
        task = asyncio.create_task(guarded(job))
        running.add(task)
        task.add_done_callback(running.discard)

    await asyncio.gather(*running, return_exceptions=True)
