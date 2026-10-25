import secrets
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.accounts import ACCOUNT_NAME, set_active_family
from app.auth import CurrentUser, require_member
from app.avatars import AVATAR_COLUMNS, avatar_url
from app.db import pool
from app.family_roles import Kind, relationship

router = APIRouter(prefix="/api", tags=["families"])


class Family(BaseModel):
    id: UUID
    name: str
    invite_code: str
    # The family every screen shows. `GET /families` lists it first.
    is_active: bool = False


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
    avatar_url: str | None = None


class Relationship(BaseModel):
    """Directed edge: `a` is the `kind` of `b` (a parent of b, a spouse of b, a sibling of b)."""

    a: UUID
    b: UUID
    kind: str
    a_role: str | None = None
    b_role: str | None = None


class TreeConnection(BaseModel):
    user_id: UUID
    display_name: str
    kind: str
    person_id: UUID | None = None


class AddTreeConnection(BaseModel):
    user_id: UUID
    anchor_person_id: UUID
    kind: Kind


class FamilyTree(BaseModel):
    people: list[Person]
    relationships: list[Relationship]
    me: UUID | None = None
    # People with a Tell Me More account, as opposed to relatives only added by name.
    member_person_ids: list[UUID]


class ChooseFamily(BaseModel):
    family_id: UUID


class CreateFamily(BaseModel):
    name: str
    your_name: str


class JoinFamily(BaseModel):
    invite_code: str
    your_name: str


class CreatePerson(BaseModel):
    family_id: UUID
    display_name: str
    relation_label: str | None = None
    birth_year: int | None = None
    is_living: bool = True


@router.get("/families")
async def list_families(user: CurrentUser) -> list[Family]:
    """The active family first (see accounts.HOME_FAMILY), then owned, then oldest."""
    rows = await pool().fetch(
        "select f.id, f.name, f.invite_code from family f "
        "join member m on m.family_id = f.id "
        "left join profile pr on pr.user_id = m.user_id where m.user_id = $1 "
        "order by coalesce(f.id = pr.active_family_id, false) desc, "
        "(m.role = 'owner') desc, f.created_at",
        user.id,
    )
    return [Family(**r, is_active=i == 0) for i, r in enumerate(rows)]


@router.put("/families/active")
async def choose_family(body: ChooseFamily, user: CurrentUser) -> Family:
    async with pool().acquire() as conn, conn.transaction():
        await require_member(conn, user, body.family_id)
        await set_active_family(conn, user.id, body.family_id)
        row = await conn.fetchrow(
            "select id, name, invite_code from family where id = $1", body.family_id
        )
    return Family(**row, is_active=True)


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
        await set_active_family(conn, user.id, family["id"])
    return Family(**family, is_active=True)


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
        await set_active_family(conn, user.id, family["id"])
    return Family(**family, is_active=True)


# A selectable storyteller must have an account. The tree endpoint also includes relatives
# added only by name, so it deliberately does not use this query.
_PEOPLE = f"""
    select p.id, p.family_id, p.display_name, p.full_name, p.relation_label,
           p.birth_year, p.is_living,
           coalesce((select count(*) from relationship r
             where r.family_id = p.family_id and (r.a = p.id or r.b = p.id)), 0)::int as degree,
           case when m.user_id = $2 then 'you' else c.kind end as relation,
           {AVATAR_COLUMNS}
    from person p
    join member m on m.person_id = p.id
    left join profile pr on pr.user_id = m.user_id
    left join connection c on c.user_id = $2 and c.other_id = m.user_id
    where p.family_id = $1
"""


def _person(row) -> Person:
    return Person(**row, avatar_url=avatar_url(row))


@router.get("/families/{family_id}/people")
async def list_people(family_id: UUID, user: CurrentUser) -> list[Person]:
    async with pool().acquire() as conn:
        await require_member(conn, user, family_id)
        rows = await conn.fetch(_PEOPLE + " order by p.created_at", family_id, user.id)
    return [_person(r) for r in rows]


@router.get("/families/{family_id}/people/search")
async def search_people(
    family_id: UUID, user: CurrentUser, q: str = "", limit: int = 5
) -> list[Person]:
    """Rank account-backed storytellers by name relevance, then graph degree and name."""
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
    return [_person(r) for r in rows]


@router.get("/families/{family_id}/tree")
async def get_tree(family_id: UUID, user: CurrentUser) -> FamilyTree:
    async with pool().acquire() as conn:
        me = await require_member(conn, user, family_id)
        people = await conn.fetch(
            "select p.id, p.family_id, p.display_name, p.relation_label, p.birth_year, "
            f"p.is_living, {AVATAR_COLUMNS} from person p "
            "left join member m on m.person_id = p.id "
            "left join profile pr on pr.user_id = m.user_id "
            "where p.family_id = $1 order by p.created_at",
            family_id,
        )
        edges = await conn.fetch(
            "select a, b, kind, a_role, b_role from relationship where family_id = $1", family_id
        )
        members = await conn.fetch(
            "select person_id from member where family_id = $1 and person_id is not null",
            family_id,
        )
    return FamilyTree(
        people=[_person(r) for r in people],
        relationships=[Relationship(**r) for r in edges],
        me=me,
        member_person_ids=[r["person_id"] for r in members],
    )


@router.get("/families/{family_id}/tree/connections")
async def tree_connections(family_id: UUID, user: CurrentUser) -> list[TreeConnection]:
    async with pool().acquire() as conn:
        await require_member(conn, user, family_id)
        rows = await conn.fetch(
            f"select c.other_id as user_id, c.kind, p.id as person_id, "
            f"{ACCOUNT_NAME.format(user='c.other_id')} as display_name "
            "from connection c left join member m on m.user_id=c.other_id and m.family_id=$2 "
            "left join person p on p.id=m.person_id and p.family_id=$2 "
            "where c.user_id=$1 order by display_name, c.other_id",
            user.id,
            family_id,
        )
    return [TreeConnection(**r) for r in rows if r["display_name"]]


@router.post("/families/{family_id}/tree/connections")
async def add_tree_connection(
    family_id: UUID, body: AddTreeConnection, user: CurrentUser
) -> Relationship:
    from app.routers.invites import check_tree_rules

    async with pool().acquire() as conn, conn.transaction():
        await require_member(conn, user, family_id)
        # Serialize all graph edits, including invitation accepts, so cycle/parent checks hold.
        await conn.execute("select 1 from family where id=$1 for update", family_id)
        if not await conn.fetchval(
            "select 1 from person where id=$1 and family_id=$2", body.anchor_person_id, family_id
        ):
            raise HTTPException(404, "that person is not in this family")
        if not await conn.fetchval(
            "select 1 from connection where user_id=$1 and other_id=$2", user.id, body.user_id
        ):
            raise HTTPException(403, "choose someone you are already connected with")
        person_id = await conn.fetchval(
            "select m.person_id from member m join person p on p.id=m.person_id "
            "and p.family_id=m.family_id where m.user_id=$1 and m.family_id=$2",
            body.user_id,
            family_id,
        )
        if person_id is None:
            raise HTTPException(409, "they need to join this family first; share an invitation")
        a, b, kind, a_role, b_role = relationship(body.kind, body.anchor_person_id, person_id)
        previous = await conn.fetchrow(
            "select a,b,kind,a_role,b_role from relationship where family_id=$1 "
            "and a=$2 and b=$3 and kind=$4",
            family_id,
            a,
            b,
            kind,
        )
        if previous:
            # Refine the chosen person's label (child -> son) without erasing the anchor's
            # existing role (dad), or changing the actual relationship/direction.
            previous = await conn.fetchrow(
                "update relationship set a_role=$5,b_role=$6 "
                "where family_id=$1 and a=$2 and b=$3 and kind=$4 "
                "returning a,b,kind,a_role,b_role",
                family_id,
                a,
                b,
                kind,
                a_role if person_id == a else previous["a_role"] or a_role,
                b_role if person_id == b else previous["b_role"] or b_role,
            )
            return Relationship(**previous)
        await check_tree_rules(conn, body.anchor_person_id, person_id, body.kind)
        await conn.execute(
            "insert into relationship(family_id,a,b,kind,a_role,b_role) values($1,$2,$3,$4,$5,$6)",
            family_id,
            a,
            b,
            kind,
            a_role,
            b_role,
        )
    return Relationship(a=a, b=b, kind=kind, a_role=a_role, b_role=b_role)


@router.post("/people", status_code=status.HTTP_201_CREATED)
async def create_person(body: CreatePerson, user: CurrentUser) -> Person:
    async with pool().acquire() as conn:
        await require_member(conn, user, body.family_id)
        row = await conn.fetchrow(
            "insert into person (family_id, display_name, relation_label, birth_year, is_living) "
            "values ($1, $2, $3, $4, $5) "
            "returning id, family_id, display_name, relation_label, birth_year, is_living",
            body.family_id,
            body.display_name,
            body.relation_label,
            body.birth_year,
            body.is_living,
        )
    return Person(**row)
