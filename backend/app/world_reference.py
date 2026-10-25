"""Finds a real photo of the place a memory happened, so World Labs builds on a picture instead of
text alone (docs/IMMERSIVE.md §5.6). Only used when the family's own photo is a close-up."""

import asyncio
import logging

import httpx

from app import providers
from app.jobs.stages.common import sniff_image_mime
from app.models import ReferencePicks
from app.prompts import prompt
from app.providers.base import Blob, ImageResult

log = logging.getLogger(__name__)

MAX_CANDIDATES = 8
MIN_WIDTH = 1024
MAX_BYTES = 8 * 1024 * 1024
# Vision judges the same full-size files World Labs would get; a thumbnail hides watermarks.
VISION_BUDGET = 16 * 1024 * 1024
_WORLD_LABS_MIMES = {"image/jpeg", "image/png", "image/webp"}
# Some hosts (Wikimedia among them) refuse requests without a descriptive agent.
_HEADERS = {"User-Agent": "HeirloomStories/1.0 (immersive reference photos)"}


def shortlist(maps: list[ImageResult], images: list[ImageResult]) -> list[ImageResult]:
    """Photos of the named place come first. Image results known to be too small are dropped."""
    seen: set[str] = set()
    out: list[ImageResult] = []
    for c in [*maps, *images]:
        if c.url in seen or (c.width is not None and c.width < MIN_WIDTH):
            continue
        seen.add(c.url)
        out.append(c)
    return out[:MAX_CANDIDATES]


async def _download(url: str) -> bytes | None:
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True, headers=_HEADERS) as h:
            r = await h.get(url)
        r.raise_for_status()
    except httpx.HTTPError:
        log.info("reference photo %s did not download", url, exc_info=True)
        return None
    return r.content if len(r.content) <= MAX_BYTES else None


async def _image(url: str) -> Blob | None:
    data = await _download(url)
    if data is None or (mime := sniff_image_mime(data)) not in _WORLD_LABS_MIMES:
        return None
    return Blob(data=data, mime=mime)


async def find(
    *, place_query: str, place_name: str | None, scene_prompt: str
) -> tuple[ImageResult, Blob] | None:
    p = providers.get_providers()
    images = await p.search.images(place_query)
    maps = await p.search.place_photos(place_name) if place_name else []
    found = shortlist(maps, images)
    downloaded = await asyncio.gather(*(_image(c.url) for c in found))
    shown: list[tuple[ImageResult, Blob]] = []
    total = 0
    for c, image in zip(found, downloaded, strict=True):
        if image is not None and total + len(image.data) <= VISION_BUDGET:
            shown.append((c, image))
            total += len(image.data)
    if not shown:
        return None

    listing = "\n".join(f"[{i}] {c.title} ({c.via})" for i, (c, _) in enumerate(shown))
    picks = await p.vision.json(
        system=prompt("immersive_reference"),
        messages=[{"role": "user", "content": f"Scene:\n{scene_prompt}\n\nPhotos:\n{listing}"}],
        schema=ReferencePicks,
        images=[image for _, image in shown],
    )
    best = next((i for i in picks.ranked if 0 <= i < len(shown)), None)
    return shown[best] if best is not None else None
