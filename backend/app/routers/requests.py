"""Story requests: listener asks a relative for an object's story (Brief §3E–F, §4, §6).

States: pending → in_progress → completed | declined | cancelled.
Idempotency_key prevents double-tap duplicates (§7).
"""

from typing import Literal
from uuid import UUID

import asyncpg
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.auth import CurrentUser, family_of_heirloom, require_member
from app.db import pool
from app.routers.notifications import create_notification
from app.storage import signed_download_url

router = APIRouter(prefix="/api/requests", tags=["requests"])


class StoryRequest(BaseModel):
    id: UUID
    heirloom_id: UUID
    capture_media_id: UUID | None = None
    listener_id: UUID
    storyteller_id: UUID
    message: str = ""
    status: str
    created_at: str | None = None


class CreateRequest(BaseModel):
    heirloom_id: UUID
    storyteller_id: UUID
    capture_media_id: UUID | None = None
    message: str = ""
    idempotency_key: str | None = None


class RequestDetail(StoryRequest):
    heirloom_title: str | None = None
    heirloom_cover_url: str | None = None
    capture_url: str | None = None
    listener_name: str | None = None
    storyteller_name: str | None = None
    # The caller's side, resolved in the request's own family (callers can belong to several).
    viewer_role: Literal["storyteller", "listener", "member"] = "member"


async def _detail(conn: asyncpg.Connection, request_id: UUID, viewer_id: UUID) -> RequestDetail:
    r = await conn.fetchrow(
        """
        select r.id, r.heirloom_id, r.capture_media_id, r.listener_id, r.storyteller_id,
               r.message, r.status, r.created_at::text,
               h.title as heirloom_title, cm.storage_path as cover_path,
               cap.storage_path as capture_path,
               lp.display_name as listener_name, sp.display_name as storyteller_name
        from story_request r
        join heirloom h on h.id = r.heirloom_id
        left join media cm on cm.id = h.cover_media_id
        left join media cap on cap.id = r.capture_media_id
        join person lp on lp.id = r.listener_id
        join person sp on sp.id = r.storyteller_id
        where r.id = $1
        """,
        request_id,
    )
    if r is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "request not found")
    cover = await signed_download_url("photos", r["cover_path"]) if r["cover_path"] else None
    cap_url = None
    if r["capture_path"]:
        # capture is usually a photo; storage bucket is not encoded in the path,
        # so try photos then audio.
        try:
            cap_url = await signed_download_url("photos", r["capture_path"])
        except Exception:
            cap_url = await signed_download_url("audio", r["capture_path"])
    return RequestDetail(
        id=r["id"],
        heirloom_id=r["heirloom_id"],
        capture_media_id=r["capture_media_id"],
        listener_id=r["listener_id"],
        storyteller_id=r["storyteller_id"],
        message=r["message"] or "",
        status=r["status"],
        created_at=r["created_at"],
        heirloom_title=r["heirloom_title"],
        heirloom_cover_url=cover,
        capture_url=cap_url,
        listener_name=r["listener_name"],
        storyteller_name=r["storyteller_name"],
        viewer_role="storyteller"
        if viewer_id == r["storyteller_id"]
        else "listener"
        if viewer_id == r["listener_id"]
        else "member",
    )


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_request(body: CreateRequest, user: CurrentUser) -> RequestDetail:
    async with pool().acquire() as conn:
        family_id = await family_of_heirloom(conn, body.heirloom_id)
        listener_id = await require_member(conn, user, family_id)
        teller_family = await conn.fetchval(
            "select family_id from person where id = $1", body.storyteller_id
        )
        if teller_family is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "storyteller not found")
        if teller_family != family_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "storyteller is not in this family")
        if body.storyteller_id == listener_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "ask someone else for the story")
        if body.capture_media_id:
            ok = await conn.fetchval(
                "select 1 from media where id = $1 and heirloom_id = $2",
                body.capture_media_id,
                body.heirloom_id,
            )
            if not ok:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "capture not found")
        if body.idempotency_key:
            existing = await conn.fetchrow(
                "select id, heirloom_id, listener_id, storyteller_id from story_request "
                "where idempotency_key = $1",
                body.idempotency_key,
            )
            if existing:
                if (
                    existing["heirloom_id"] != body.heirloom_id
                    or existing["listener_id"] != listener_id
                    or existing["storyteller_id"] != body.storyteller_id
                ):
                    raise HTTPException(
                        status.HTTP_409_CONFLICT,
                        "idempotency key was already used for another request",
                    )
                await create_notification(
                    conn,
                    ntype="request_received",
                    recipient_id=existing["storyteller_id"],
                    request_id=existing["id"],
                )
                return await _detail(conn, existing["id"], listener_id)
        async with conn.transaction():
            row = await conn.fetchrow(
                "insert into story_request "
                "(heirloom_id, capture_media_id, listener_id, storyteller_id, message, "
                " status, idempotency_key) values ($1, $2, $3, $4, $5, 'pending', $6) "
                "returning id",
                body.heirloom_id,
                body.capture_media_id,
                listener_id,
                body.storyteller_id,
                body.message or "",
                body.idempotency_key,
            )
            await create_notification(
                conn,
                ntype="request_received",
                recipient_id=body.storyteller_id,
                request_id=row["id"],
            )
        return await _detail(conn, row["id"], listener_id)


@router.get("")
async def list_requests(
    user: CurrentUser, scope: str = "all", family_id: UUID | None = None
) -> list[StoryRequest]:
    """The caller's sent/received requests across families, optionally filtered to one family."""
    if scope not in ("all", "mine", "incoming"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "bad scope")
    side = {
        "all": "(r.listener_id = m.person_id or r.storyteller_id = m.person_id)",
        "mine": "r.listener_id = m.person_id",
        "incoming": "r.storyteller_id = m.person_id",
    }[scope]
    async with pool().acquire() as conn:
        if family_id is not None:
            await require_member(conn, user, family_id)
        q = (
            "select r.id, r.heirloom_id, r.capture_media_id, r.listener_id, r.storyteller_id, "
            "r.message, r.status, r.created_at::text from story_request r "
            "join heirloom h on h.id = r.heirloom_id "
            "where exists (select 1 from member m "
            f"where m.user_id = $1 and m.family_id = h.family_id and {side})"
        )
        args: list = [user.id]
        if family_id is not None:
            q += " and h.family_id = $2"
            args.append(family_id)
        q += " order by r.created_at desc, r.id desc"
        rows = await conn.fetch(q, *args)
    return [StoryRequest(**dict(r, message=r["message"] or "")) for r in rows]


@router.get("/{request_id}")
async def get_request(request_id: UUID, user: CurrentUser) -> RequestDetail:
    async with pool().acquire() as conn:
        r = await conn.fetchrow("select heirloom_id from story_request where id = $1", request_id)
        if r is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "request not found")
        me = await require_member(conn, user, await family_of_heirloom(conn, r["heirloom_id"]))
        return await _detail(conn, request_id, me)


def _check_actor(listener_id: UUID, storyteller_id: UUID, me: UUID, who: str) -> None:
    want = storyteller_id if who == "storyteller" else listener_id
    if me != want:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"only the {who} can do this")


@router.post("/{request_id}/accept")
async def accept_request(request_id: UUID, user: CurrentUser) -> StoryRequest:
    async with pool().acquire() as conn:
        r = await conn.fetchrow("select * from story_request where id = $1", request_id)
        if r is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "request not found")
        me = await require_member(conn, user, await family_of_heirloom(conn, r["heirloom_id"]))
        _check_actor(r["listener_id"], r["storyteller_id"], me, "storyteller")
        if r["status"] != "pending":
            raise HTTPException(status.HTTP_409_CONFLICT, f"request is {r['status']}")
        row = await conn.fetchrow(
            "update story_request set status = 'in_progress' where id = $1 returning "
            "id, heirloom_id, capture_media_id, listener_id, storyteller_id, message, "
            "status, created_at::text",
            request_id,
        )
    return StoryRequest(**dict(row, message=row["message"] or ""))


@router.post("/{request_id}/decline")
async def decline_request(request_id: UUID, user: CurrentUser) -> StoryRequest:
    async with pool().acquire() as conn:
        r = await conn.fetchrow("select * from story_request where id = $1", request_id)
        if r is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "request not found")
        me = await require_member(conn, user, await family_of_heirloom(conn, r["heirloom_id"]))
        _check_actor(r["listener_id"], r["storyteller_id"], me, "storyteller")
        if r["status"] == "declined":
            await create_notification(
                conn,
                ntype="request_declined",
                recipient_id=r["listener_id"],
                request_id=request_id,
            )
            row = await conn.fetchrow(
                "select id, heirloom_id, capture_media_id, listener_id, storyteller_id, "
                "message, status, created_at::text from story_request where id = $1",
                request_id,
            )
            return StoryRequest(**dict(row, message=row["message"] or ""))
        if r["status"] not in ("pending", "in_progress"):
            raise HTTPException(status.HTTP_409_CONFLICT, f"request is {r['status']}")
        async with conn.transaction():
            row = await conn.fetchrow(
                "update story_request set status = 'declined' where id = $1 returning "
                "id, heirloom_id, capture_media_id, listener_id, storyteller_id, message, "
                "status, created_at::text",
                request_id,
            )
            await create_notification(
                conn,
                ntype="request_declined",
                recipient_id=r["listener_id"],
                request_id=request_id,
            )
    return StoryRequest(**dict(row, message=row["message"] or ""))


@router.post("/{request_id}/cancel")
async def cancel_request(request_id: UUID, user: CurrentUser) -> StoryRequest:
    async with pool().acquire() as conn:
        r = await conn.fetchrow("select * from story_request where id = $1", request_id)
        if r is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "request not found")
        me = await require_member(conn, user, await family_of_heirloom(conn, r["heirloom_id"]))
        _check_actor(r["listener_id"], r["storyteller_id"], me, "listener")
        if r["status"] not in ("pending", "in_progress"):
            raise HTTPException(status.HTTP_409_CONFLICT, f"request is {r['status']}")
        row = await conn.fetchrow(
            "update story_request set status = 'cancelled' where id = $1 returning "
            "id, heirloom_id, capture_media_id, listener_id, storyteller_id, message, "
            "status, created_at::text",
            request_id,
        )
    return StoryRequest(**dict(row, message=row["message"] or ""))
