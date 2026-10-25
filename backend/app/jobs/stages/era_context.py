"""Stage 6. (year, place) pairs -> SerpApi search -> cited context cards (§5.5)."""

import asyncio
from collections import Counter
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app import providers
from app.db import pool
from app.jobs.queue import enqueue
from app.prompts import prompt
from app.providers.base import SerpResult

MAX_PAIRS = 3
RESULTS_PER_QUERY = 5
Topic = Literal["events", "music", "fashion", "prices", "place"]


class EraCard(BaseModel):
    topic: Topic
    summary: str
    source_indices: list[int] = Field(min_length=1)


class EraCards(BaseModel):
    cards: list[EraCard] = Field(max_length=3)


def top_pairs(facts: list[tuple[int, str | None]]) -> list[tuple[int, str | None]]:
    """Most-mentioned (year, place) pairs first. A pair with a place beats the bare year."""
    counts = Counter(facts)
    ranked = sorted(counts, key=lambda p: (-counts[p], p[1] is None, p[0]))
    return ranked[:MAX_PAIRS]


def queries(year: int, place: str | None) -> dict[Topic, str]:
    where = f" {place}" if place else ""
    return {
        "events": f"{year}{where} events news",
        "music": f"popular music {year}{where}",
        "prices": f"cost of living prices {year}{where}",
    }


async def _cards(year: int, place: str | None) -> list[tuple]:
    p = providers.get_providers()
    found = await asyncio.gather(*(p.search.web(q) for q in queries(year, place).values()))
    results: list[SerpResult] = [r for rs in found for r in rs[:RESULTS_PER_QUERY]]
    if not results:
        return []
    listing = "\n".join(
        f"[{i}] {r.title} ({r.date or 'undated'}): {r.snippet or ''}" for i, r in enumerate(results)
    )
    out = await p.llm.json(
        system=prompt("era_context", year=str(year), place=place or "the world"),
        messages=[{"role": "user", "content": listing}],
        schema=EraCards,
    )
    retrieved_at = datetime.now(UTC).isoformat()
    rows = []
    for card in out.cards:
        used = [results[i] for i in dict.fromkeys(card.source_indices) if 0 <= i < len(results)]
        if used:
            sources = [
                {"url": r.link, "title": r.title, "retrieved_at": retrieved_at} for r in used
            ]
            rows.append((year, place, card.topic, card.summary, sources))
    return rows


async def run(heirloom_id: UUID) -> None:
    async with pool().acquire() as conn:
        family_id = await conn.fetchval("select family_id from heirloom where id = $1", heirloom_id)
        facts = await conn.fetch(
            "select year, place from fact where heirloom_id = $1 and kind = 'memory' "
            "and year between 1800 and extract(year from now())",
            heirloom_id,
        )

    pairs = top_pairs([(f["year"], f["place"]) for f in facts])
    cards = [c for cs in await asyncio.gather(*(_cards(y, pl) for y, pl in pairs)) for c in cs]

    async with pool().acquire() as conn, conn.transaction():
        await conn.execute("delete from context_card where heirloom_id = $1", heirloom_id)
        await conn.executemany(
            "insert into context_card (heirloom_id, year, place, topic, summary, sources) "
            "values ($1, $2, $3, $4, $5, $6)",
            [(heirloom_id, *c) for c in cards],
        )
        await enqueue(conn, "compose_story", heirloom_id, family_id)
