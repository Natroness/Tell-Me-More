"""Accounts and the connections between them.

A user's home family is the one they are looking at: the active family they chose, else the
one they own. Connecting two accounts makes each a member of the other's home family, so the
existing family-scoped access (stories, requests, interviews) lets them see each other's
objects. Each side keeps its own Family/Friend label in `connection`. Family links also share
one view: someone alone in their own family adopts the other's, so both see the same objects,
dates, tree and availability.
"""

from typing import Literal
from uuid import UUID

import asyncpg

Kind = Literal["family", "friend"]

# These SQL fragments are spliced into callers' queries, so their aliases are prefixed to never
# capture a caller's own table alias.

# The family a user chose to look at, else the one they own, else the first one they joined.
HOME_FAMILY = """
    select hm.family_id from member hm join family hf on hf.id = hm.family_id
    left join profile hp on hp.user_id = hm.user_id
    where hm.user_id = {user}
    order by coalesce(hm.family_id = hp.active_family_id, false) desc,
             (hm.role = 'owner') desc, hf.created_at
    limit 1
"""

# Their own chosen name, else the name they gave in their home family.
ACCOUNT_NAME = """
    coalesce(
      (select nullif(trim(an_pr.display_name), '') from profile an_pr
        where an_pr.user_id = {user}),
      (select an_p.display_name from member an_m join person an_p on an_p.id = an_m.person_id
         join family an_f on an_f.id = an_m.family_id
        where an_m.user_id = {user}
        order by (an_m.role = 'owner') desc, an_f.created_at limit 1)
    )
"""


def in_archive(owner: str, viewer: str, heirloom: str = "h") -> str:
    """SQL condition: the heirloom belongs to owner's archive and viewer may open it.

    An archive holds the objects someone photographed and the ones they told the story of.
    """
    return f"""
        exists (select 1 from member ar_v
                where ar_v.user_id = {viewer} and ar_v.family_id = {heirloom}.family_id)
        and ({heirloom}.created_by = {owner} or exists (
          select 1 from interview ar_i join member ar_t on ar_t.person_id = ar_i.narrator_id
          where ar_i.heirloom_id = {heirloom}.id and ar_t.user_id = {owner}))
    """


async def home_family(conn: asyncpg.Connection, user_id: UUID) -> UUID | None:
    return await conn.fetchval(HOME_FAMILY.format(user="$1"), user_id)


async def account_name(conn: asyncpg.Connection, user_id: UUID) -> str | None:
    return await conn.fetchval(f"select {ACCOUNT_NAME.format(user='$1')}", user_id)


async def set_active_family(conn: asyncpg.Connection, user_id: UUID, family_id: UUID) -> None:
    """Caller checks membership."""
    await conn.execute(
        "insert into profile (user_id, display_name, active_family_id) values ($1, $2, $3) "
        "on conflict (user_id) do update set active_family_id = excluded.active_family_id",
        user_id,
        await account_name(conn, user_id),
        family_id,
    )


async def is_alone(conn: asyncpg.Connection, user_id: UUID) -> bool:
    """True when the user's home family has nobody else in it (or they have none)."""
    family_id = await home_family(conn, user_id)
    if family_id is None:
        return True
    return await conn.fetchval("select count(*) from member where family_id = $1", family_id) <= 1


async def connect(
    conn: asyncpg.Connection, a: UUID, b: UUID, a_sees_b: Kind, b_sees_a: Kind
) -> None:
    """Idempotent. Run inside a transaction."""
    before = {a: await home_family(conn, a), b: await home_family(conn, b)}
    alone = {a: await is_alone(conn, a), b: await is_alone(conn, b)}
    await conn.execute(
        "insert into connection (user_id, other_id, kind) values ($1, $2, $3), ($2, $1, $4) "
        "on conflict (user_id, other_id) do update set kind = excluded.kind",
        a,
        b,
        a_sees_b,
        b_sees_a,
    )
    for host, guest in ((a, b), (b, a)):
        family_id = await home_family(conn, host)
        if family_id is None:
            continue
        joined = await conn.fetchval(
            "select 1 from member where user_id = $1 and family_id = $2", guest, family_id
        )
        if joined:
            continue
        person_id = await conn.fetchval(
            "insert into person (family_id, display_name) values ($1, $2) returning id",
            family_id,
            await account_name(conn, guest) or "Someone",
        )
        await conn.execute(
            "insert into member (user_id, family_id, person_id) values ($1, $2, $3)",
            guest,
            family_id,
            person_id,
        )
    # The sender's family is shared unless only the accepter already has relatives in theirs.
    shared = before[b] if alone[a] and not alone[b] else before[a]
    for user, kind in ((a, a_sees_b), (b, b_sees_a)):
        if kind == "family" and alone[user] and shared is not None and before[user] != shared:
            await set_active_family(conn, user, shared)
