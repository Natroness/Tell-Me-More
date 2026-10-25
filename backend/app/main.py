import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import db
from app.config import get_settings
from app.jobs.runner import run_worker
from app.routers import (
    answer_stream,
    availability,
    connections,
    dev_auth,
    events,
    families,
    heirlooms,
    immersive,
    interviews,
    invites,
    memories,
    notifications,
    profiles,
    requests,
    speech,
    stories,
    storytime,
    timeline,
)

log = logging.getLogger("lorebook")


@asynccontextmanager
async def lifespan(_: FastAPI):
    s = get_settings()
    if not s.database_url:
        log.warning("DATABASE_URL not set: API routes that touch the DB will fail, worker is off")
        yield
        return
    await db.open_pool(s.database_url, s.db_pool_size)
    stop = asyncio.Event()
    worker = (
        asyncio.create_task(run_worker(stop, s.worker_concurrency)) if s.worker_enabled else None
    )
    try:
        yield
    finally:
        stop.set()
        if worker:
            await worker
        await db.close_pool()


app = FastAPI(title="Lorebook API", lifespan=lifespan)

for r in (
    families,
    dev_auth,
    availability,
    events,
    heirlooms,
    interviews,
    answer_stream,
    connections,
    memories,
    stories,
    storytime,
    speech,
    timeline,
    requests,
    notifications,
    profiles,
    invites,
    immersive,
):
    app.include_router(r.router)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
