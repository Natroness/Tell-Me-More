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


def sniff_image_mime(data: bytes) -> str:
    if data.startswith(b"\x89PNG"):
        return "image/png"
    if data.startswith(b"\xff\xd8"):
        return "image/jpeg"
    if data[8:12] == b"WEBP":
        return "image/webp"
    return "application/octet-stream"
