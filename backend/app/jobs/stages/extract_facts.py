"""Stage 5. Segments + memory notes -> memory facts with citations. Subject is the heirloom id.

The model cites short refs (S3, N1) rather than UUIDs; we map them back and drop any fact
whose refs don't resolve, so a memory fact always points at something a person said or wrote.
"""

from uuid import UUID

from pydantic import BaseModel, Field

from app import providers
from app.db import pool
from app.jobs.queue import enqueue
from app.models import MemorySource
from app.prompts import prompt


class ExtractedFact(BaseModel):
    text: str
    refs: list[str] = Field(min_length=1)
    year: int | None = None
    place: str | None = None
    people: list[str] = []  # names as spoken; matched to family members below


class ExtractedFacts(BaseModel):
    facts: list[ExtractedFact]


async def run(heirloom_id: UUID) -> None:
    async with pool().acquire() as conn:
        family_id = await conn.fetchval("select family_id from heirloom where id = $1", heirloom_id)
        segments = await conn.fetch(
            """
            select s.id, s.text, i.narrator_id, p.display_name
            from segment s
            join turn t on t.id = s.turn_id
            join interview i on i.id = t.interview_id
            join person p on p.id = i.narrator_id
            where i.heirloom_id = $1
            order by i.created_at, t.idx, s.start_ms
            """,
            heirloom_id,
        )
        notes = await conn.fetch(
            "select n.id, n.text, n.author_id, p.display_name from memory_note n "
            "join person p on p.id = n.author_id "
            "where n.heirloom_id = $1 and n.text is not null order by n.created_at",
            heirloom_id,
        )
        people = await conn.fetch(
            "select id, display_name, full_name from person where family_id = $1", family_id
        )

    seg_refs = {f"S{i + 1}": s for i, s in enumerate(segments)}
    note_refs = {f"N{i + 1}": n for i, n in enumerate(notes)}
    rows = []
    if seg_refs or note_refs:
        listing = [f"[{r}] {s['display_name']}: {s['text']}" for r, s in seg_refs.items()]
        listing += [f"[{r}] {n['display_name']} wrote: {n['text']}" for r, n in note_refs.items()]
        result = await providers.get_providers().llm.json(
            system=prompt("extract_facts"),
            messages=[{"role": "user", "content": "\n".join(listing)}],
            schema=ExtractedFacts,
        )
        names = {
            name.casefold(): p["id"]
            for p in people
            for name in (p["display_name"], p["full_name"])
            if name
        }
        for f in result.facts:
            source = _source(f.refs, seg_refs, note_refs)
            if source is None:
                continue
            ids = list(
                dict.fromkeys(names[n.casefold()] for n in f.people if n.casefold() in names)
            )
            rows.append((heirloom_id, f.text, source.model_dump(mode="json"), f.year, f.place, ids))

    async with pool().acquire() as conn, conn.transaction():
        await conn.execute(
            "delete from fact where heirloom_id = $1 and kind = 'memory'", heirloom_id
        )
        await conn.executemany(
            "insert into fact (heirloom_id, kind, text, source, year, place, people) "
            "values ($1, 'memory', $2, $3, $4, $5, $6)",
            rows,
        )
        await enqueue(conn, "era_context", heirloom_id, family_id)


def _source(refs: list[str], seg_refs: dict, note_refs: dict) -> MemorySource | None:
    """Spoken refs win over written ones; a fact belongs to one narrator."""
    segs = [seg_refs[r] for r in refs if r in seg_refs]
    if segs:
        narrator = segs[0]["narrator_id"]
        return MemorySource(
            kind="memory",
            segment_ids=[s["id"] for s in segs if s["narrator_id"] == narrator],
            narrator_id=narrator,
        )
    note = next((note_refs[r] for r in refs if r in note_refs), None)
    if note is None:
        return None
    return MemorySource(kind="memory", memory_note_id=note["id"], narrator_id=note["author_id"])
