from uuid import UUID

import asyncpg


async def cover_photo(conn: asyncpg.Connection, heirloom_id: UUID) -> asyncpg.Record:
    row = await conn.fetchrow(
        "select m.id, m.storage_path, m.mime from heirloom h "
        "join media m on m.id = h.cover_media_id where h.id = $1",
        heirloom_id,
    )
    if row is None:
        raise LookupError(f"heirloom {heirloom_id} has no cover photo")
    return row
