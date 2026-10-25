import asyncio

from app.jobs.queue import enqueue
from app.jobs.runner import run_worker
from app.models import ObjectReading
from tests.test_live_pipeline import READING


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
    await enqueue(conn, "compose_story", seed.heirloom_id, seed.family_id)  # still a stub

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
    assert failed["attempts"] == 3 and "NotImplementedError" in failed["error"]
    assert await conn.fetchval("select title from heirloom where id = $1", seed.heirloom_id)
