"""Stage 2. Heirloom photo -> SerpApi Google Lens matches -> observation facts (via=lens)."""

from uuid import UUID

from pydantic import BaseModel, Field

from app import providers, storage
from app.db import pool
from app.jobs.stages.common import cover_photo
from app.models import ObservationSource
from app.prompts import prompt

MAX_MATCHES = 10
MIN_CONFIDENCE = 0.5


class LensFinding(BaseModel):
    text: str
    match_index: int
    confidence: float = Field(ge=0, le=1)


class LensFindings(BaseModel):
    findings: list[LensFinding] = Field(max_length=3)


async def run(heirloom_id: UUID) -> None:
    async with pool().acquire() as conn:
        photo = await cover_photo(conn, heirloom_id)
    p = providers.get_providers()
    # Lens fetches the image itself, so it needs a URL it can reach.
    url = await storage.signed_download_url("photos", photo["storage_path"], expires_in=600)
    matches = (await p.search.lens(url))[:MAX_MATCHES]

    findings: list[LensFinding] = []
    if matches:
        listing = "\n".join(
            f"[{i}] {m.title} ({m.source or m.link})" for i, m in enumerate(matches)
        )
        result = await p.llm.json(
            system=prompt("lens_lookup"),
            messages=[{"role": "user", "content": listing}],
            schema=LensFindings,
        )
        findings = [
            f
            for f in result.findings
            if 0 <= f.match_index < len(matches) and f.confidence >= MIN_CONFIDENCE
        ]

    async with pool().acquire() as conn, conn.transaction():
        await conn.execute(
            "delete from fact where heirloom_id = $1 and kind = 'observation' "
            "and source->>'via' = 'lens'",
            heirloom_id,
        )
        await conn.executemany(
            "insert into fact (heirloom_id, kind, text, source, confidence) "
            "values ($1, 'observation', $2, $3, $4)",
            [
                (
                    heirloom_id,
                    f.text,
                    ObservationSource(
                        kind="observation",
                        media_id=photo["id"],
                        via="lens",
                        url=matches[f.match_index].link,
                    ).model_dump(mode="json"),
                    f.confidence,
                )
                for f in findings
            ],
        )
