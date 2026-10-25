"""Short database operations shared by the resumable stages."""

from uuid import UUID

from app.db import pool


class Superseded(Exception):
    """The user removed this video or selected a newer generation."""


async def current(attempt_id: UUID):
    async with pool().acquire() as conn:
        return await conn.fetchrow("select * from storytime where generation_id = $1", attempt_id)


async def update(attempt_id: UUID, *, status: str | None = None, asset=None, error=None):
    async with pool().acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                "select id from storytime where generation_id = $1 for update", attempt_id
            )
            if row is None:
                raise Superseded()
            if asset:
                await conn.execute(
                    "update storytime set assets = assets || $2::jsonb, updated_at = now() "
                    "where generation_id = $1",
                    attempt_id,
                    asset,
                )
                await conn.execute(
                    "update storytime_attempt set assets = assets || $2::jsonb where id = $1",
                    attempt_id,
                    asset,
                )
            if status:
                await conn.execute(
                    "update storytime set status = $2, error = $3, updated_at = now() "
                    "where generation_id = $1",
                    attempt_id,
                    status,
                    error,
                )


async def load_story(conn, story_id: UUID):
    return await conn.fetchrow(
        "select s.*, coalesce(s.storyteller_id,i.narrator_id,m.person_id) as narrator_id, "
        "p.display_name as narrator_name from story s "
        "join heirloom h on h.id=s.heirloom_id "
        "left join lateral (select narrator_id from interview where heirloom_id=h.id "
        "and language='en' order by created_at desc limit 1) i on true "
        "left join member m on m.user_id=h.created_by and m.family_id=h.family_id "
        "left join person p on p.id=coalesce(s.storyteller_id,i.narrator_id,m.person_id) "
        "where s.id=$1 and s.status='published'",
        story_id,
    )
