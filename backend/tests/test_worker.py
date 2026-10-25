import asyncio
from uuid import uuid4

import pytest

from app.config import get_settings
from app.jobs import runner
from app.jobs.queue import enqueue
from app.jobs.runner import run_worker
from app.models import ObjectReading
from tests.test_live_pipeline import READING


@pytest.mark.parametrize("slow_kind", ["immersive_world", "storytime_script", "storytime_render"])
async def test_slow_jobs_never_hold_up_the_interview(conn, fakes, seed, monkeypatch, slow_kind):
    monkeypatch.setattr(get_settings(), "immersive_concurrency", 2)
    running, most = 0, 0
    finish_worlds = asyncio.Event()
    question_asked = asyncio.Event()
    two_running = asyncio.Event()

    async def world(subject_id):
        nonlocal running, most
        running += 1
        most = max(most, running)
        if running == 2:
            two_running.set()
        try:
            await finish_worlds.wait()
        finally:
            running -= 1

    async def question(subject_id):
        question_asked.set()

    monkeypatch.setitem(runner.HANDLERS, slow_kind, world)
    monkeypatch.setitem(runner.HANDLERS, "next_question", question)
    for _ in range(3):
        await enqueue(conn, slow_kind, uuid4(), seed.family_id)
    await enqueue(conn, "next_question", uuid4(), seed.family_id)

    stop = asyncio.Event()
    # One fast slot: if world jobs could take it, the question would wait behind them forever.
    worker = asyncio.create_task(run_worker(stop, concurrency=1))
    try:
        async with asyncio.timeout(2):
            await question_asked.wait()
            await two_running.wait()
        await asyncio.sleep(0.3)
        assert most == 2, "no more worlds at once than immersive_concurrency"
    finally:
        finish_worlds.set()
        stop.set()
        await worker


async def test_a_worker_leaves_jobs_it_has_no_stage_for(conn, fakes, seed, monkeypatch):
    """A worker on older code (no immersive stage yet) must not fail newer jobs it can't run."""
    question_asked = asyncio.Event()

    async def question(subject_id):
        question_asked.set()

    monkeypatch.delitem(runner.HANDLERS, "immersive_world")
    monkeypatch.setitem(runner.HANDLERS, "next_question", question)
    world_id = uuid4()
    await enqueue(conn, "immersive_world", world_id, seed.family_id)
    await enqueue(conn, "next_question", uuid4(), seed.family_id)

    stop = asyncio.Event()
    worker = asyncio.create_task(run_worker(stop, concurrency=1))
    try:
        async with asyncio.timeout(2):
            await question_asked.wait()
        await asyncio.sleep(2.5)  # past a slow-lane poll
    finally:
        stop.set()
        await worker

    job = await conn.fetchrow(
        "select status, attempts from job where kind = 'immersive_world' and subject_id = $1",
        world_id,
    )
    assert job["status"] == "queued" and job["attempts"] == 0


async def wait_for_status(conn, kind, subject_id, statuses):
    async with asyncio.timeout(5):
        while True:
            status = await conn.fetchval(
                "select status from job where kind = $1 and subject_id = $2", kind, subject_id
            )
            if status in statuses:
                return status
            await asyncio.sleep(0.05)


async def test_worker_runs_queued_jobs_and_records_failures(conn, fakes, seed):
    fakes.llm.responses[ObjectReading] = READING
    await enqueue(conn, "analyze_object", seed.heirloom_id, seed.family_id)
    await enqueue(conn, "compose_story", seed.heirloom_id, seed.family_id)  # no memories yet

    stop = asyncio.Event()
    worker = asyncio.create_task(run_worker(stop, concurrency=4))
    try:
        assert await wait_for_status(conn, "analyze_object", seed.heirloom_id, {"done"}) == "done"
        assert (
            await wait_for_status(conn, "compose_story", seed.heirloom_id, {"failed"}) == "failed"
        )
    finally:
        stop.set()
        await worker

    failed = await conn.fetchrow(
        "select attempts, error from job where kind = 'compose_story' and subject_id = $1",
        seed.heirloom_id,
    )
    assert failed["attempts"] == 3 and "LookupError" in failed["error"]
    assert await conn.fetchval("select title from heirloom where id = $1", seed.heirloom_id)
