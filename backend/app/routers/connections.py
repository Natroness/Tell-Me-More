"""Family and Friends: requests between real accounts, accepted by the other person."""

from uuid import UUID

from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel

from app.accounts import ACCOUNT_NAME, Kind, account_name, connect, in_archive
from app.auth import CurrentUser
from app.db import pool

router = APIRouter(prefix="/api", tags=["connections"])


class Account(BaseModel):
    user_id: UUID
    display_name: str


class Connection(Account):
    kind: Kind
    story_count: int


class ConnectionRequest(Account):
    """display_name is the other person. kind is what the sender asked to be."""

    id: UUID
    kind: Kind


class Requests(BaseModel):
    incoming: list[ConnectionRequest]
    outgoing: list[ConnectionRequest]


class SendRequest(BaseModel):
    user_id: UUID
    kind: Kind = "family"


class Sent(BaseModel):
    id: UUID
    status: str


class Choice(BaseModel):
    kind: Kind = "family"


@router.get("/me")
async def me(user: CurrentUser) -> Account:
    async with pool().acquire() as conn:
        name = await account_name(conn, user.id)
    return Account(user_id=user.id, display_name=name or "")


@router.get("/connections")
async def list_connections(user: CurrentUser) -> list[Connection]:
    async with pool().acquire() as conn:
        rows = await conn.fetch(
            f"""
            select c.other_id as user_id, c.kind,
                   {ACCOUNT_NAME.format(user="c.other_id")} as display_name,
                   (select count(*) from heirloom h
                     where exists (select 1 from story s where s.heirloom_id = h.id)
                       and {in_archive("c.other_id", "$1")})::int as story_count
            from connection c where c.user_id = $1
            order by c.kind, display_name
            """,
            user.id,
        )
    return [Connection(**r) for r in rows if r["display_name"]]


@router.patch("/connections/{other_id}")
async def relabel(other_id: UUID, body: Choice, user: CurrentUser) -> Choice:
    """Changes only how you see them; their label for you is theirs."""
    async with pool().acquire() as conn:
        done = await conn.fetchval(
            "update connection set kind = $3 where user_id = $1 and other_id = $2 returning 1",
            user.id,
            other_id,
            body.kind,
        )
    if not done:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not connected")
    return body


@router.get("/connections/requests")
async def list_requests(user: CurrentUser) -> Requests:
    async with pool().acquire() as conn:
        rows = await conn.fetch(
            f"""
            select x.id, x.kind, x.incoming, x.other_id as user_id,
                   {ACCOUNT_NAME.format(user="x.other_id")} as display_name
            from (
              select r.id, r.kind, r.created_at, r.to_user = $1 as incoming,
                     case when r.to_user = $1 then r.from_user else r.to_user end as other_id
              from connection_request r
              where r.status = 'pending' and $1 in (r.from_user, r.to_user)
            ) x
            order by x.created_at desc
            """,
            user.id,
        )
    out = Requests(incoming=[], outgoing=[])
    for r in rows:
        req = ConnectionRequest(
            id=r["id"], user_id=r["user_id"], display_name=r["display_name"] or "", kind=r["kind"]
        )
        (out.incoming if r["incoming"] else out.outgoing).append(req)
    return out


@router.get("/users/search")
async def search_users(user: CurrentUser, q: str = "") -> list[Account]:
    """Accounts you could send a request to: never yourself, nobody already connected or asked."""
    query = q.strip()
    if len(query) < 2:
        return []
    async with pool().acquire() as conn:
        rows = await conn.fetch(
            f"""
            select * from (
              select u.id as user_id, {ACCOUNT_NAME.format(user="u.id")} as display_name
              from auth.users u
              where u.id != $1
                and not exists (select 1 from connection c
                                where c.user_id = $1 and c.other_id = u.id)
                and not exists (select 1 from connection_request r where r.status = 'pending'
                                and (r.from_user, r.to_user) in (($1, u.id), (u.id, $1)))
            ) named
            where display_name ilike '%' || $2 || '%'
            order by (display_name ilike $2 || '%') desc, display_name
            limit 5
            """,
            user.id,
            query,
        )
    return [Account(**r) for r in rows]


@router.post("/connections/requests", status_code=status.HTTP_201_CREATED)
async def send_request(body: SendRequest, user: CurrentUser) -> Sent:
    """If they already asked you, sending one back accepts theirs."""
    if body.user_id == user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "that's you")
    async with pool().acquire() as conn, conn.transaction():
        if not await conn.fetchval("select 1 from auth.users where id = $1", body.user_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "no such account")
        if await conn.fetchval(
            "select 1 from connection where user_id = $1 and other_id = $2", user.id, body.user_id
        ):
            raise HTTPException(status.HTTP_409_CONFLICT, "already connected")
        theirs = await conn.fetchrow(
            "select id, kind from connection_request "
            "where status = 'pending' and from_user = $1 and to_user = $2",
            body.user_id,
            user.id,
        )
        if theirs:
            await _accept(conn, theirs["id"], body.user_id, user.id, theirs["kind"], body.kind)
            return Sent(id=theirs["id"], status="accepted")
        request_id = await conn.fetchval(
            "insert into connection_request (from_user, to_user, kind) values ($1, $2, $3) "
            "on conflict do nothing returning id",
            user.id,
            body.user_id,
            body.kind,
        )
        if request_id is None:
            raise HTTPException(status.HTTP_409_CONFLICT, "already asked")
    return Sent(id=request_id, status="pending")


async def _pending_for(conn, request_id: UUID, user_id: UUID):
    r = await conn.fetchrow(
        "select from_user, kind from connection_request "
        "where id = $1 and to_user = $2 and status = 'pending' for update",
        request_id,
        user_id,
    )
    if r is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no open request for you")
    return r


async def _accept(conn, request_id, sender: UUID, accepter: UUID, sender_kind, accepter_kind):
    await conn.execute(
        "update connection_request set status = 'accepted', responded_at = now() where id = $1",
        request_id,
    )
    await connect(conn, sender, accepter, sender_kind, accepter_kind)


@router.post("/connections/requests/{request_id}/accept")
async def accept(request_id: UUID, body: Choice, user: CurrentUser) -> Sent:
    async with pool().acquire() as conn, conn.transaction():
        r = await _pending_for(conn, request_id, user.id)
        await _accept(conn, request_id, r["from_user"], user.id, r["kind"], body.kind)
    return Sent(id=request_id, status="accepted")


@router.post("/connections/requests/{request_id}/decline", status_code=status.HTTP_204_NO_CONTENT)
async def decline(request_id: UUID, user: CurrentUser) -> Response:
    async with pool().acquire() as conn, conn.transaction():
        await _pending_for(conn, request_id, user.id)
        await conn.execute(
            "update connection_request set status = 'declined', responded_at = now() where id = $1",
            request_id,
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
