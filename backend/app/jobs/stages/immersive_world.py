"""Immersive memories (docs/IMMERSIVE.md §5.4). Subject is the immersive_world id.

Runs only in the slow worker lane, and only when someone asked for this world. Every step is
resumable: after a restart the job skips whatever the row already holds, and a world already
started at World Labs is polled again rather than paid for twice. No database connection is held
while waiting on World Labs or the model.
"""

import asyncio
import logging
import random
import re
import time
from typing import Any
from uuid import UUID

import asyncpg
import httpx

from app import providers, storage, world_reference
from app.config import get_settings
from app.db import pool
from app.jobs.stages.common import sniff_image_mime
from app.models import Hotspot, ReferencePhoto, SceneSpec, SpotPositions
from app.prompts import prompt
from app.providers.base import Blob, RateLimited, WorldAssets

log = logging.getLogger(__name__)

_MIME = {"spz": "application/octet-stream", "glb": "model/gltf-binary"}


async def _wait(seconds: float) -> None:
    await asyncio.sleep(seconds)


async def _set(world_id: UUID, **fields: Any) -> None:
    cols = ", ".join(f"{k} = ${i}" for i, k in enumerate(fields, 2))
    async with pool().acquire() as conn:
        await conn.execute(
            f"update immersive_world set {cols}, updated_at = now() where id = $1",
            world_id,
            *fields.values(),
        )


async def _load(conn: asyncpg.Connection, world_id: UUID) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        """
        select w.id, w.family_id, w.heirloom_id, w.status, w.scene_prompt, w.input_mode,
               w.provider_operation_id, w.assets, w.hotspots, w.reference, w.input_audit,
               m.storage_path as photo_path, m.mime as photo_mime,
               coalesce(h.title, h.category, 'a family heirloom') as object_name,
               (select p.display_name from interview i join person p on p.id = i.narrator_id
                 where i.heirloom_id = w.heirloom_id order by i.created_at limit 1) as narrator
        from immersive_world w
        join media m on m.id = w.source_media_id
        join heirloom h on h.id = w.heirloom_id
        where w.id = $1
        """,
        world_id,
    )
    return dict(row) if row else None


async def run(world_id: UUID) -> None:
    async with pool().acquire() as conn:
        w = await _load(conn, world_id)
    # A failed world waits for someone to ask again, which resets it to queued. Job retries
    # must not spend another generation on it.
    if w is None or w["status"] in ("ready", "failed"):
        return
    try:
        if w["scene_prompt"] is None:
            await _write_scene(w)
        if w["assets"] is None:
            if w["provider_operation_id"] is None:
                await _prepare_reference(w)
            await _save(w, await _generate(w))
    except Exception as e:
        await _set(world_id, status="failed", error=str(e)[:500] or repr(e))
        raise
    await _place_spots(w)
    await _set(world_id, status="ready", error=None)


async def _photo(w: dict[str, Any]) -> Blob:
    return Blob(data=await storage.download("photos", w["photo_path"]), mime=w["photo_mime"])


async def _source_image(w: dict[str, Any]) -> Blob:
    """What World Labs builds from besides the text: the family's photo when it shows the place,
    or a validated scene reference prepared before generation."""
    match w["input_mode"]:
        case "image":
            return await _photo(w)
        case "reference":
            ref = ReferencePhoto(**w["reference"])
            return Blob(data=await storage.download("generated", ref.path), mime=ref.mime)
        case _:
            raise ValueError("A scene reference image is required before building a world")


async def _write_scene(w: dict[str, Any]) -> None:
    await _set(w["id"], status="writing_scene")
    async with pool().acquire() as conn:
        facts = await conn.fetch(
            "select id, kind, text, source from fact where heirloom_id = $1 "
            "and kind in ('memory', 'observation') order by kind, created_at",
            w["heirloom_id"],
        )
    if not any(f["kind"] == "memory" for f in facts):
        raise ValueError("not enough story details yet")
    listing = "\n".join(f"[{f['id']}] ({f['kind']}) {f['text']}" for f in facts)
    spec = await providers.get_providers().vision.json(
        system=prompt("immersive_scene"),
        messages=[
            {
                "role": "user",
                "content": f"Narrator: {w['narrator'] or 'the narrator'}\n"
                f"Object: {w['object_name']}\nFacts:\n{listing}",
            }
        ],
        schema=SceneSpec,
        images=[await _photo(w)],
    )
    by_id = {f["id"]: f for f in facts}
    used = [i for i in dict.fromkeys(spec.used_fact_ids) if i in by_id]
    if not used:
        raise ValueError("not enough story details yet")
    spots = [s.model_dump(mode="json") for s in _spots(spec, by_id)]
    scene = {
        "scene_prompt": spec.scene_prompt,
        "input_mode": spec.input_mode,
        "hotspots": spots,
        "reference": None,
        "input_audit": {
            "version": 2,
            "source_classification": spec.input_mode,
            "place_query": spec.place_query,
            "place_name": spec.place_name,
        },
    }
    await _set(w["id"], used_fact_ids=used, **scene)
    w.update(scene)


async def _prepare_reference(w: dict[str, Any]) -> None:
    """Never silently fall back to text, including cached plans created by older workers."""
    audit = dict(w.get("input_audit") or {})
    audit["version"] = 2
    if w["input_mode"] == "reference" and w.get("reference"):
        try:
            image = await _source_image(w)
            audit.update(
                source=ReferencePhoto(**w["reference"]).via,
                image=await asyncio.to_thread(world_reference.image_details, image),
            )
            await _set(w["id"], input_audit=audit)
            w["input_audit"] = audit
            return
        except (ValueError, OSError, httpx.HTTPError):
            audit["cached_reference"] = "invalid"
    if w["input_mode"] == "image":
        try:
            image = await _photo(w)
            audit.update(
                source="family_photo",
                image=await asyncio.to_thread(world_reference.image_details, image),
            )
            await _set(w["id"], input_audit=audit)
            w["input_audit"] = audit
            return
        except ValueError:
            audit["family_photo"] = "not_a_usable_landscape_image"
    query = audit.get("place_query") or re.sub(r"\s+", " ", w["scene_prompt"]).strip()[:120]
    audit["effective_query"] = query
    await _set(w["id"], status="finding_reference")
    try:
        try:
            found = await world_reference.find(
                place_query=query,
                place_name=audit.get("place_name"),
                scene_prompt=w["scene_prompt"],
                audit=audit,
            )
        except Exception as exc:
            audit["web_reference"] = "failed"
            audit["web_error"] = type(exc).__name__
            found = None
        if found:
            result, image = found
            metadata = dict(
                url=result.url, page_url=result.page_url, title=result.title, via=result.via
            )
            audit["image"] = await asyncio.to_thread(world_reference.image_details, image)
        else:
            image = await world_reference.generate(w["scene_prompt"], audit)
            metadata = dict(title="AI-generated scene reference", via="generated")
        path = storage.world_path(
            w["family_id"], w["heirloom_id"], w["id"], "reference", image.mime.split("/")[-1]
        )
        await storage.upload("generated", path, image.data, image.mime)
        reference = ReferencePhoto(path=path, mime=image.mime, **metadata)
        audit["source"] = reference.via
        scene = {
            "reference": reference.model_dump(mode="json"),
            "input_mode": "reference",
            "input_audit": audit,
        }
        await _set(w["id"], **scene)
        w.update(scene)
    except Exception:
        await _set(w["id"], input_audit=audit)
        raise


def _spots(spec: SceneSpec, facts: dict[UUID, asyncpg.Record]) -> list[Hotspot]:
    """The planned spots, keeping only this story's facts. Each plays the clips its memory
    facts came from, so a spot can only ever voice what the narrator said."""
    spots: list[Hotspot] = []
    for plan in spec.hotspots:
        ids = [i for i in dict.fromkeys(plan.fact_ids) if i in facts]
        if not ids:
            continue
        base = re.sub(r"[^a-z0-9]+", "-", plan.label.lower()).strip("-") or "spot"
        slug, n = base, 2
        while any(s.id == slug for s in spots):
            slug, n = f"{base}-{n}", n + 1
        clips = [
            UUID(seg)
            for i in ids
            if facts[i]["kind"] == "memory"
            for seg in facts[i]["source"].get("segment_ids", [])
        ]
        spots.append(
            Hotspot(id=slug, label=plan.label, fact_ids=ids, segment_ids=list(dict.fromkeys(clips)))
        )
    return spots


async def _backoff(e: RateLimited, deadline: float) -> None:
    if time.monotonic() + e.retry_after > deadline:
        raise TimeoutError("World Labs stayed busy too long") from e
    await _wait(e.retry_after + random.uniform(0, 1 + e.retry_after * 0.2))


async def _generate(w: dict[str, Any]) -> WorldAssets:
    s = get_settings()
    world = providers.get_providers().world
    deadline = time.monotonic() + s.immersive_timeout_seconds
    op_id = w["provider_operation_id"]
    await _set(w["id"], status="generating")
    if op_id is None:
        await _set(w["id"], model=s.worldlabs_model)
        image = await _source_image(w)
        audit = dict(w.get("input_audit") or {})
        audit.update(request_type="image", requested_model=s.worldlabs_model)
        await _set(w["id"], input_audit=audit)
        while op_id is None:
            try:
                op_id = await world.start(
                    prompt=w["scene_prompt"], image=image, display_name=w["object_name"]
                )
            except RateLimited as e:
                await _backoff(e, deadline)
        # Saved before polling: if this job dies now, the next run polls this same world.
        await _set(w["id"], provider_operation_id=op_id)
        w["provider_operation_id"] = op_id

    while True:
        try:
            op = await world.poll(op_id)
        except RateLimited as e:
            await _backoff(e, deadline)
            continue
        except httpx.TransportError:
            log.warning("polling world %s failed; trying again", w["id"], exc_info=True)
            op = None
        except httpx.HTTPStatusError:
            await _set(w["id"], provider_operation_id=None)  # expired: a retry starts fresh
            raise
        if op and op.done:
            break
        if time.monotonic() > deadline:
            raise TimeoutError("the world took too long to build")
        await _wait(s.immersive_poll_seconds)

    if op.error or op.result is None:
        await _set(w["id"], provider_operation_id=None)
        raise RuntimeError(op.error or "World Labs returned no world")
    return op.result


async def _save(w: dict[str, Any], result: WorldAssets) -> None:
    """Copies the files into our storage: World Labs URLs may expire, and family worlds stay
    behind the family's own access rules."""
    await _set(w["id"], status="saving", provider_world_id=result.world_id)
    wanted = {
        "spz_100k": (result.spz_urls.get("100k"), "spz"),
        "spz_500k": (result.spz_urls.get("500k"), "spz"),
        "pano": (result.pano_url, None),
        "thumbnail": (result.thumbnail_url, None),
        "collider": (result.collider_mesh_url, "glb"),
    }
    if not (wanted["spz_100k"][0] or wanted["spz_500k"][0]):
        raise RuntimeError("World Labs returned no splat files")
    world = providers.get_providers().world
    assets: dict[str, str] = {}
    for name, (url, ext) in wanted.items():
        if not url:
            continue
        data = await world.fetch(url)
        mime = _MIME[ext] if ext else sniff_image_mime(data)
        path = storage.world_path(
            w["family_id"], w["heirloom_id"], w["id"], name, ext or mime.split("/")[-1]
        )
        await storage.upload("generated", path, data, mime)
        assets[name] = path
    await _set(
        w["id"],
        assets=assets,
        semantics={
            "metric_scale_factor": result.metric_scale_factor,
            "ground_plane_offset": result.ground_plane_offset,
        },
    )
    w["assets"] = assets


async def _place_spots(w: dict[str, Any]) -> None:
    """Finds each spot on the panorama. If this fails, the viewer lists the spots instead, so it
    never fails the world."""
    spots = [Hotspot(**h) for h in w["hotspots"]]
    pano_path = (w["assets"] or {}).get("pano")
    if not spots or not pano_path:
        return
    try:
        await _set(w["id"], status="placing_spots")
        pano = await storage.download("generated", pano_path)
        found = await providers.get_providers().vision.json(
            system=prompt("immersive_spots"),
            messages=[
                {"role": "user", "content": "Spot labels:\n" + "\n".join(s.label for s in spots)}
            ],
            schema=SpotPositions,
            images=[Blob(data=pano, mime=sniff_image_mime(pano))],
        )
        at = {p.label: p for p in found.spots if p.u is not None and p.v is not None}
        placed = [
            s.model_copy(update={"u": at[s.label].u, "v": at[s.label].v}) if s.label in at else s
            for s in spots
        ]
        await _set(w["id"], hotspots=[s.model_dump(mode="json") for s in placed])
    except Exception:
        log.warning("placing spots in world %s failed; they stay as a list", w["id"], exc_info=True)
