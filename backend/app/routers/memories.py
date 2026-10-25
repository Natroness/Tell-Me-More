from uuid import UUID

from fastapi import APIRouter, status
from pydantic import BaseModel, Field

from app.auth import CurrentUser, family_of_heirloom, require_member
from app.db import pool
from app.jobs.queue import enqueue

router = APIRouter(prefix="/api/heirlooms", tags=["memories"])


class NewMemory(BaseModel):
    text: str = Field(min_length=1)


class MemoryNote(BaseModel):
    id: UUID
    heirloom_id: UUID
    author_id: UUID
    text: str | None


@router.post("/{heirloom_id}/memories", status_code=status.HTTP_201_CREATED)
async def add_memory(heirloom_id: UUID, body: NewMemory, user: CurrentUser) -> MemoryNote:
    async with pool().acquire() as conn:
        family_id = await family_of_heirloom(conn, heirloom_id)
        author_id = await require_member(conn, user, family_id)
        async with conn.transaction():
            row = await conn.fetchrow(
                "insert into memory_note (heirloom_id, author_id, text) values ($1, $2, $3) "
                "returning id, heirloom_id, author_id, text",
                heirloom_id,
                author_id,
                body.text,
            )
            await enqueue(conn, "extract_facts", heirloom_id, family_id)
    return MemoryNote(**row)
