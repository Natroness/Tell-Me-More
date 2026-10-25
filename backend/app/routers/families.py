import secrets
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.auth import CurrentUser, require_member
from app.db import pool

router = APIRouter(prefix="/api", tags=["families"])


class Family(BaseModel):
    id: UUID
    name: str
    invite_code: str


class Person(BaseModel):
    id: UUID
    family_id: UUID
    display_name: str
    full_name: str | None = None
    relation_label: str | None = None
    birth_year: int | None = None
    is_living: bool = True
    degree: int = 0
    # From the caller's side: "you", or how they labelled this person's account.
    relation: str | None = None


class CreateFamily(BaseModel):
    name: str
    your_name: str


class JoinFamily(BaseModel):
    invite_code: str
    your_name: str


@router.get("/families")
async def list_families(user: CurrentUser) -> list[Family]:
    rows = await pool().fetch(
        "select f.id, f.name, f.invite_code from family f "
        "join member m on m.family_id = f.id where m.user_id = $1 "
        "order by (m.role = 'owner') desc, f.created_at",
        user.id,
    )
    return [Family(**r) for r in rows]


@router.post("/families", status_code=status.HTTP_201_CREATED)
async def create_family(body: CreateFamily, user: CurrentUser) -> Family:
    async with pool().acquire() as conn, conn.transaction():
        family = await conn.fetchrow(
            "insert into family (name, invite_code) values ($1, $2) "
            "returning id, name, invite_code",
            body.name,
            secrets.token_urlsafe(6),
        )
        person_id = await conn.fetchval(
            "insert into person (family_id, display_name) values ($1, $2) returning id",
            family["id"],
            body.your_name,
        )
        await conn.execute(
            "insert into member (user_id, family_id, person_id, role) values ($1, $2, $3, 'owner')",
            user.id,
            family["id"],
            person_id,
        )
    return Family(**family)


@router.post("/families/join")
async def join_family(body: JoinFamily, user: CurrentUser) -> Family:
    async with pool().acquire() as conn, conn.transaction():
        family = await conn.fetchrow(
            "select id, name, invite_code from family where invite_code = $1", body.invite_code
        )
        if family is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "invite code not found")
        already = await conn.fetchval(
            "select 1 from member where user_id = $1 and family_id = $2", user.id, family["id"]
        )
        if not already:
            person_id = await conn.fetchval(
                "insert into person (family_id, display_name) values ($1, $2) returning id",
                family["id"],
                body.your_name,
            )
            await conn.execute(
                "insert into member (user_id, family_id, person_id) values ($1, $2, $3)",
                user.id,
                family["id"],
                person_id,
            )
    return Family(**family)


# Only people with an account: a name typed in without one is nobody you can ask or connect to.
_PEOPLE = """
    select p.id, p.family_id, p.display_name, p.full_name, p.relation_label,
           p.birth_year, p.is_living,
           coalesce((select count(*) from relationship r
             where r.family_id = p.family_id and (r.a = p.id or r.b = p.id)), 0)::int as degree,
           case when m.user_id = $2 then 'you' else c.kind end as relation
    from person p
    join member m on m.person_id = p.id
    left join connection c on c.user_id = $2 and c.other_id = m.user_id
    where p.family_id = $1
"""


@router.get("/families/{family_id}/people")
async def list_people(family_id: UUID, user: CurrentUser) -> list[Person]:
    async with pool().acquire() as conn:
        await require_member(conn, user, family_id)
        rows = await conn.fetch(_PEOPLE + " order by p.created_at", family_id, user.id)
    return [Person(**r) for r in rows]


@router.get("/families/{family_id}/people/search")
async def search_people(
    family_id: UUID, user: CurrentUser, q: str = "", limit: int = 5
) -> list[Person]:
    """Ranked name search for request recipients (Brief §3E).

    Returns 0–5 people: text relevance first (exact → prefix → contains →
    full-name), then social-graph degree, then name. Empty query returns [].
    """
    query = q.strip()
    if not query:
        return []
    limit = max(1, min(limit, 5))
    async with pool().acquire() as conn:
        await require_member(conn, user, family_id)
        rows = await conn.fetch(
            _PEOPLE
            + """
              and (p.display_name ilike '%' || $3 || '%' or p.full_name ilike '%' || $3 || '%')
            order by case
                       when lower(p.display_name) = lower($3) then 0
                       when p.display_name ilike $3 || '%' then 1
                       when p.display_name ilike '%' || $3 || '%' then 2
                       else 3
                     end, degree desc, p.display_name
            limit $4
            """,
            family_id,
            user.id,
            query,
            limit,
        )
    return [Person(**r) for r in rows]
