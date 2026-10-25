"""Stage 8. Story title + object facts -> Muse Image cover. Re-runs overwrite the same file."""

from uuid import UUID, uuid4

from app import providers, storage
from app.db import pool
from app.jobs.stages.common import sniff_image_mime

MAX_DETAILS = 5


def cover_prompt(title: str, category: str | None, details: list[str]) -> str:
    seen = " ".join(details) or f"a treasured family {category or 'heirloom'}"
    return (
        f"A warm, painterly book-cover illustration for a family story titled '{title}'. "
        f"The heirloom at the center: {seen} "
        "Soft natural light, muted earthy colors, quiet and timeless. "
        "No text, no letters, no faces."
    )


async def run(heirloom_id: UUID) -> None:
    async with pool().acquire() as conn:
        heirloom = await conn.fetchrow(
            """
            select h.family_id, h.category, s.title from heirloom h
            join lateral (
              select title from story where heirloom_id = h.id order by version desc limit 1
            ) s on true
            where h.id = $1
            """,
            heirloom_id,
        )
        if heirloom is None:
            raise LookupError(f"heirloom {heirloom_id} has no story yet")
        details = await conn.fetch(
            "select text from fact where heirloom_id = $1 and kind = 'observation' "
            "and source->>'via' = 'vision' order by confidence desc nulls last limit $2",
            heirloom_id,
            MAX_DETAILS,
        )
        existing = await conn.fetchval(
            "select id from media where heirloom_id = $1 and kind = 'generated_image' "
            "and storage_path not like '%/storytime/%'",
            heirloom_id,
        )

    image = await providers.get_providers().image.generate(
        cover_prompt(heirloom["title"], heirloom["category"], [d["text"] for d in details])
    )
    mime = sniff_image_mime(image)
    media_id = existing or uuid4()
    path = storage.object_path(heirloom["family_id"], heirloom_id, media_id, mime)
    await storage.upload("generated", path, image, mime)

    async with pool().acquire() as conn:
        await conn.execute(
            """
            insert into media (id, family_id, heirloom_id, kind, storage_path, mime)
            values ($1, $2, $3, 'generated_image', $4, $5)
            on conflict (id) do update set storage_path = excluded.storage_path,
              mime = excluded.mime
            """,
            media_id,
            heirloom["family_id"],
            heirloom_id,
            path,
            mime,
        )
