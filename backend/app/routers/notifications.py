"""In-app notifications (Brief §6–7). Push-off fallback: persisted inbox + Realtime."""

from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.auth import CurrentUser
from app.db import pool

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


class Notification(BaseModel):
    id: UUID
    recipient_id: UUID
    type: str
    request_id: UUID | None = None
    story_id: UUID | None = None
    heirloom_id: UUID | None = None
    read_at: str | None = None
    created_at: str | None = None


@router.get("")
async def list_notifications(user: CurrentUser) -> list[Notification]:
    async with pool().acquire() as conn:
        rows = await conn.fetch(
            """
            select n.id, n.recipient_id, n.type, n.request_id, n.story_id, s.heirloom_id,
                   n.read_at::text as read_at, n.created_at::text as created_at
            from notification n left join story s on s.id = n.story_id
            where n.recipient_id in (select person_id from member where user_id = $1)
            order by n.read_at nulls first, n.created_at desc
            limit 100
            """,
            user.id,
        )
    return [Notification(**r) for r in rows]


@router.post("/{notification_id}/read")
async def mark_read(notification_id: UUID, user: CurrentUser) -> Notification:
    async with pool().acquire() as conn:
        mine = await conn.fetchval(
            "select 1 from notification n "
            "join member m on m.person_id = n.recipient_id "
            "where n.id = $1 and m.user_id = $2",
            notification_id,
            user.id,
        )
        if not mine:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "notification not found")
        row = await conn.fetchrow(
            "update notification set read_at = coalesce(read_at, now()) where id = $1 "
            "returning id, recipient_id, type, request_id, story_id, "
            "read_at::text as read_at, created_at::text as created_at",
            notification_id,
        )
    return Notification(**row)
