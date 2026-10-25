"""Stage 1. Heirloom photo -> observation facts, title/category suggestion, seed questions."""

from uuid import UUID

from app import providers, storage
from app.db import pool
from app.jobs.queue import set_output
from app.jobs.stages.common import cover_photo
from app.models import ObjectReading, ObservationSource
from app.prompts import prompt
from app.providers.base import Blob


async def run(heirloom_id: UUID) -> None:
    async with pool().acquire() as conn:
        photo = await cover_photo(conn, heirloom_id)
    image = Blob(data=await storage.download("photos", photo["storage_path"]), mime=photo["mime"])

    reading = await providers.get_providers().vision.json(
        system=prompt("analyze_object"),
        messages=[{"role": "user", "content": "Here is the family heirloom."}],
        schema=ObjectReading,
        images=[image],
    )

    async with pool().acquire() as conn, conn.transaction():
        await conn.execute(
            "delete from fact where heirloom_id = $1 and kind = 'observation' "
            "and source->>'via' = 'vision'",
            heirloom_id,
        )
        await conn.executemany(
            "insert into fact (heirloom_id, kind, text, source, confidence) "
            "values ($1, 'observation', $2, $3, $4)",
            [
                (
                    heirloom_id,
                    d.detail,
                    ObservationSource(
                        kind="observation", media_id=photo["id"], bbox=d.bbox, via="vision"
                    ).model_dump(mode="json"),
                    d.confidence,
                )
                for d in reading.details
            ],
        )
        await conn.execute(
            "update heirloom set title = coalesce(title, $2), category = coalesce(category, $3), "
            "signature = $4 where id = $1",
            heirloom_id,
            reading.suggested_title,
            reading.category,
            reading.signature,
        )
        await set_output(conn, "analyze_object", heirloom_id, reading.model_dump(mode="json"))
