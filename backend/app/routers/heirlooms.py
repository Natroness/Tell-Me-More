from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app import providers
from app.auth import CurrentUser, family_of_heirloom, require_member
from app.db import pool
from app.jobs.queue import enqueue
from app.models import Fact, HeirloomCategory
from app.prompts import prompt
from app.storage import object_path, signed_download_url, signed_upload_url

router = APIRouter(prefix="/api/heirlooms", tags=["heirlooms"])


class Heirloom(BaseModel):
    id: UUID
    family_id: UUID
    title: str | None
    category: HeirloomCategory | None
    cover_url: str | None = None


class HeirloomDetail(BaseModel):
    heirloom: Heirloom
    observations: list[Fact]
    seed_questions: list[str]
    latest_story_version: int | None


class CreateHeirloom(BaseModel):
    family_id: UUID
    # The cover is what vision and Lens read, so it must be an image. A video capture sends a
    # still frame here and the video itself through POST /{id}/media.
    photo_mime: str = Field(pattern=r"^image/")


class AddMedia(BaseModel):
    mime: str = Field(pattern=r"^(image|video)/")


class AddedMedia(BaseModel):
    media_id: UUID
    upload_url: str


class CreatedHeirloom(BaseModel):
    heirloom_id: UUID
    media_id: UUID
    upload_url: str


async def _cover_url(path: str | None) -> str | None:
    return await signed_download_url("photos", path) if path else None


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_heirloom(body: CreateHeirloom, user: CurrentUser) -> CreatedHeirloom:
    heirloom_id, media_id = uuid4(), uuid4()
    path = object_path(body.family_id, heirloom_id, media_id, body.photo_mime)
    async with pool().acquire() as conn:
        await require_member(conn, user, body.family_id)
        async with conn.transaction():
            await conn.execute(
                "insert into heirloom (id, family_id, created_by) values ($1, $2, $3)",
                heirloom_id,
                body.family_id,
                user.id,
            )
            await conn.execute(
                "insert into media (id, family_id, heirloom_id, kind, storage_path, mime, "
                "created_by) values ($1, $2, $3, 'photo', $4, $5, $6)",
                media_id,
                body.family_id,
                heirloom_id,
                path,
                body.photo_mime,
                user.id,
            )
    return CreatedHeirloom(
        heirloom_id=heirloom_id,
        media_id=media_id,
        upload_url=await signed_upload_url("photos", path),
    )


@router.post("/{heirloom_id}/photos/{media_id}/complete", status_code=status.HTTP_202_ACCEPTED)
async def photo_uploaded(heirloom_id: UUID, media_id: UUID, user: CurrentUser) -> None:
    async with pool().acquire() as conn:
        family_id = await family_of_heirloom(conn, heirloom_id)
        await require_member(conn, user, family_id)
        async with conn.transaction():
            await conn.execute(
                "update heirloom set cover_media_id = coalesce(cover_media_id, $2) where id = $1",
                heirloom_id,
                media_id,
            )
            await enqueue(conn, "analyze_object", heirloom_id, family_id)
            await enqueue(conn, "lens_lookup", heirloom_id, family_id)


@router.post("/{heirloom_id}/media", status_code=status.HTTP_201_CREATED)
async def add_media(heirloom_id: UUID, body: AddMedia, user: CurrentUser) -> AddedMedia:
    """Extra photos or the original video of a capture, kept beside the cover."""
    media_id = uuid4()
    kind = "video" if body.mime.startswith("video/") else "photo"
    async with pool().acquire() as conn:
        family_id = await family_of_heirloom(conn, heirloom_id)
        await require_member(conn, user, family_id)
        path = object_path(family_id, heirloom_id, media_id, body.mime)
        await conn.execute(
            "insert into media (id, family_id, heirloom_id, kind, storage_path, mime, created_by) "
            "values ($1, $2, $3, $4, $5, $6, $7)",
            media_id,
            family_id,
            heirloom_id,
            kind,
            path,
            body.mime,
            user.id,
        )
    return AddedMedia(media_id=media_id, upload_url=await signed_upload_url("photos", path))


@router.get("")
async def list_heirlooms(family_id: UUID, user: CurrentUser) -> list[Heirloom]:
    async with pool().acquire() as conn:
        await require_member(conn, user, family_id)
        rows = await conn.fetch(
            "select h.id, h.family_id, h.title, h.category, m.storage_path from heirloom h "
            "left join media m on m.id = h.cover_media_id "
            "where h.family_id = $1 order by h.created_at desc",
            family_id,
        )
    return [
        Heirloom(
            id=r["id"],
            family_id=r["family_id"],
            title=r["title"],
            category=r["category"],
            cover_url=await _cover_url(r["storage_path"]),
        )
        for r in rows
    ]


@router.get("/{heirloom_id}")
async def get_heirloom(heirloom_id: UUID, user: CurrentUser) -> HeirloomDetail:
    async with pool().acquire() as conn:
        family_id = await family_of_heirloom(conn, heirloom_id)
        await require_member(conn, user, family_id)
        h = await conn.fetchrow(
            "select h.id, h.family_id, h.title, h.category, m.storage_path from heirloom h "
            "left join media m on m.id = h.cover_media_id where h.id = $1",
            heirloom_id,
        )
        if h is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "heirloom not found")
        facts = await conn.fetch(
            "select id, heirloom_id, kind, text, source, year, place, people, confidence "
            "from fact where heirloom_id = $1 and kind = 'observation' order by created_at",
            heirloom_id,
        )
        reading = await conn.fetchval(
            "select output from job where kind = 'analyze_object' and subject_id = $1 "
            "and status = 'done'",
            heirloom_id,
        )
        version = await conn.fetchval(
            "select max(version) from story where heirloom_id = $1", heirloom_id
        )
    return HeirloomDetail(
        heirloom=Heirloom(
            id=h["id"],
            family_id=h["family_id"],
            title=h["title"],
            category=h["category"],
            cover_url=await _cover_url(h["storage_path"]),
        ),
        observations=[Fact(**f) for f in facts],
        seed_questions=(reading or {}).get("seed_questions", []),
        latest_story_version=version,
    )


# Matching a new capture against the family's saved objects (Brief §3D) -------------------------

MATCH_CONFIDENCE = 0.6
MAX_MATCHES = 3


class MatchPick(BaseModel):
    index: int
    confidence: float = Field(ge=0, le=1)


class MatchPicks(BaseModel):
    matches: list[MatchPick]


class Candidate(BaseModel):
    heirloom: Heirloom
    confidence: float
    has_story: bool
    open_request_id: UUID | None


class Matches(BaseModel):
    # analyzing: the photo is still being read; failed: reading it failed, so nothing to compare.
    status: Literal["analyzing", "ready", "failed"]
    candidates: list[Candidate] = []


# Saved objects worth asking the model about: the same kind, or sharing a word of the new
# capture's signature, closest first. Everything the prompt needs comes back in this one query.
_CANDIDATES = """
with new as (
  select title, category, signature,
         (select to_tsquery('simple', string_agg(quote_literal(lexeme), ' | '))
            from unnest(signature_terms)) as terms
  from heirloom where id = $2
)
select h.id, h.family_id, h.title, h.category, h.signature, m.storage_path,
       exists(select 1 from story s where s.heirloom_id = h.id) as has_story,
       (select r.id from story_request r where r.heirloom_id = h.id
          and r.status in ('pending', 'in_progress') limit 1) as open_request_id,
       new.title as new_title, new.category as new_category, new.signature as new_signature
from heirloom h
cross join new
left join media m on m.id = h.cover_media_id
where h.family_id = $1 and h.id <> $2 and h.title is not null
  and (h.category = new.category or h.signature_terms @@ new.terms)
order by coalesce(h.category = new.category, false) desc,
         coalesce(ts_rank(h.signature_terms, new.terms), 0) desc, h.created_at desc
limit $3
"""
MAX_CANDIDATES = 12


def _describe(title: str | None, category: str | None, signature: str | None) -> str:
    return f"{title} ({category}): {signature or 'no details noted'}"


@router.get("/{heirloom_id}/matches")
async def find_matches(heirloom_id: UUID, user: CurrentUser) -> Matches:
    async with pool().acquire() as conn:
        family_id = await family_of_heirloom(conn, heirloom_id)
        await require_member(conn, user, family_id)
        reading = await conn.fetchval(
            "select status from job where kind = 'analyze_object' and subject_id = $1",
            heirloom_id,
        )
        if reading == "failed":
            return Matches(status="failed")
        if reading != "done":
            return Matches(status="analyzing")
        saved = await conn.fetch(_CANDIDATES, family_id, heirloom_id, MAX_CANDIDATES)
    if not saved:
        return Matches(status="ready")
    new = _describe(saved[0]["new_title"], saved[0]["new_category"], saved[0]["new_signature"])
    listing = [
        f"[{i}] {_describe(h['title'], h['category'], h['signature'])}" for i, h in enumerate(saved)
    ]

    picks = await providers.get_providers().fast.json(
        system=prompt("match_heirloom"),
        messages=[
            {"role": "user", "content": f"New object: {new}\n\nSaved:\n" + "\n".join(listing)}
        ],
        schema=MatchPicks,
        effort="minimal",  # someone is watching a progress bar
    )
    best = sorted(
        (
            p
            for p in picks.matches
            if 0 <= p.index < len(saved) and p.confidence >= MATCH_CONFIDENCE
        ),
        key=lambda p: -p.confidence,
    )
    chosen = list({p.index: p for p in best}.values())[:MAX_MATCHES]
    return Matches(
        status="ready",
        candidates=[
            Candidate(
                heirloom=Heirloom(
                    id=saved[p.index]["id"],
                    family_id=saved[p.index]["family_id"],
                    title=saved[p.index]["title"],
                    category=saved[p.index]["category"],
                    cover_url=await _cover_url(saved[p.index]["storage_path"]),
                ),
                confidence=p.confidence,
                has_story=saved[p.index]["has_story"],
                open_request_id=saved[p.index]["open_request_id"],
            )
            for p in chosen
        ],
    )


@router.post("/{heirloom_id}/same-as/{target_id}")
async def merge_into(heirloom_id: UUID, target_id: UUID, user: CurrentUser) -> Heirloom:
    """The capture was an object the family already saved: keep its photos on the saved one and
    drop the duplicate record."""
    async with pool().acquire() as conn:
        family_id = await family_of_heirloom(conn, heirloom_id)
        await require_member(conn, user, family_id)
        if await family_of_heirloom(conn, target_id) != family_id or target_id == heirloom_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "not an object in this family")
        async with conn.transaction():
            await conn.execute(
                "update heirloom set cover_media_id = null where id = $1", heirloom_id
            )
            await conn.execute(
                "update media set heirloom_id = $2 where heirloom_id = $1 "
                "and kind in ('photo', 'video')",
                heirloom_id,
                target_id,
            )
            await conn.execute("delete from job where subject_id = $1", heirloom_id)
            await conn.execute("delete from heirloom where id = $1", heirloom_id)
            t = await conn.fetchrow(
                "select h.id, h.family_id, h.title, h.category, m.storage_path from heirloom h "
                "left join media m on m.id = h.cover_media_id where h.id = $1",
                target_id,
            )
    return Heirloom(
        id=t["id"],
        family_id=t["family_id"],
        title=t["title"],
        category=t["category"],
        cover_url=await _cover_url(t["storage_path"]),
    )
