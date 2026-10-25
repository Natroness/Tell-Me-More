"""Finds a real photo of the place a memory happened, so World Labs builds on a picture instead of
text alone (docs/IMMERSIVE.md §5.6). Only used when the family's own photo is a close-up."""

import asyncio
import hashlib
import io
import ipaddress
import logging
import socket
from urllib.parse import urlparse

import httpx
from PIL import Image, UnidentifiedImageError

from app import providers
from app.jobs.stages.common import sniff_image_mime
from app.models import ReferencePicks, ReferenceQuality
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


def image_details(image: Blob) -> dict:
    if image.mime not in _WORLD_LABS_MIMES or len(image.data) > MAX_BYTES:
        raise ValueError("The scene image has an unsupported format or size")
    try:
        with Image.open(io.BytesIO(image.data)) as decoded:
            width, height = decoded.size
            if width < MIN_WIDTH or height < 576 or width < height or width * height > 40_000_000:
                raise ValueError("The scene image must be a high-resolution landscape view")
            decoded.verify()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("The scene image could not be decoded") from exc
    return {
        "width": width,
        "height": height,
        "mime": image.mime,
        "sha256": hashlib.sha256(image.data).hexdigest(),
    }


async def _public_image_url(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        return False
    try:
        addresses = await asyncio.wait_for(
            asyncio.get_running_loop().getaddrinfo(
                parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM
            ),
            timeout=5,
        )
        return bool(addresses) and all(ipaddress.ip_address(a[4][0]).is_global for a in addresses)
    except (OSError, ValueError, TimeoutError):
        return False


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
        async with httpx.AsyncClient(timeout=20, headers=_HEADERS) as http:
            for _ in range(5):
                if not await _public_image_url(url):
                    return None
                async with http.stream("GET", url) as response:
                    if response.is_redirect:
                        url = str(response.url.join(response.headers["location"]))
                        continue
                    if response.is_error or not response.headers.get("content-type", "").startswith(
                        "image/"
                    ):
                        return None
                    chunks, size = [], 0
                    async for chunk in response.aiter_bytes():
                        size += len(chunk)
                        if size > MAX_BYTES:
                            return None
                        chunks.append(chunk)
                    return b"".join(chunks)
    except (httpx.HTTPError, KeyError):
        log.info("A reference photo could not be downloaded")
    return None


async def _image(url: str) -> Blob | None:
    data = await _download(url)
    if data is None or (mime := sniff_image_mime(data)) not in _WORLD_LABS_MIMES:
        return None
    image = Blob(data=data, mime=mime)
    try:
        await asyncio.to_thread(image_details, image)
    except ValueError:
        return None
    return image


async def find(
    *, place_query: str, place_name: str | None, scene_prompt: str, audit: dict | None = None
) -> tuple[ImageResult, Blob] | None:
    p = providers.get_providers()
    audit = audit if audit is not None else {}
    searches = audit.setdefault("searches", [])

    async def search(kind, query, call):
        entry = {"engine": kind, "query": query}
        searches.append(entry)
        try:
            results = await asyncio.wait_for(call(query), timeout=45)
            entry.update(status="ok", results=len(results))
            return results
        except Exception as exc:
            entry.update(status="failed", error=type(exc).__name__)
            return []

    images, maps = await asyncio.gather(
        search("google_images", place_query, p.search.images),
        search("google_maps", place_name, p.search.place_photos)
        if place_name
        else asyncio.sleep(0, result=[]),
    )
    found = shortlist(maps, images)
    slots = asyncio.Semaphore(3)

    async def download(candidate):
        async with slots:
            return await _image(candidate.url)

    downloaded = await asyncio.gather(*(download(c) for c in found))
    shown: list[tuple[ImageResult, Blob]] = []
    total = 0
    for c, image in zip(found, downloaded, strict=True):
        if image is not None and total + len(image.data) <= VISION_BUDGET:
            shown.append((c, image))
            total += len(image.data)
    if not shown:
        audit["web_reference"] = "no_downloadable_landscape_images"
        return None

    listing = "\n".join(f"[{i}] {c.title} ({c.via})" for i, (c, _) in enumerate(shown))
    picks = await asyncio.wait_for(
        p.vision.json(
            system=prompt("immersive_reference"),
            messages=[{"role": "user", "content": f"Scene:\n{scene_prompt}\n\nPhotos:\n{listing}"}],
            schema=ReferencePicks,
            images=[image for _, image in shown],
        ),
        timeout=90,
    )
    best = next((i for i in picks.ranked if 0 <= i < len(shown)), None)
    audit["web_reference"] = "selected" if best is not None else "vision_rejected_candidates"
    audit["candidates_reviewed"] = len(shown)
    return shown[best] if best is not None else None


async def generate(scene_prompt: str, audit: dict) -> Blob:
    """A validated architectural illustration when no usable real-world reference is available."""
    p = providers.get_providers()
    image_prompt = (
        "Photorealistic architectural visualization, wide landscape view at eye level. "
        "An open, coherent room or landscape with a visible floor/ground and clear paths to walk. "
        "Ordinary perspective, consistent scale, natural light, crisp details. "
        "No people, faces, signage, writing, logos, watermarks, collages or close-ups. "
        "Any keepsake is small and incidental, never in the foreground. "
        "This is an imagined representative setting, not a documentary photo. Scene: "
        + scene_prompt
    )
    attempts = audit.setdefault("generated_attempts", [])
    for _ in range(2):
        entry = {"prompt": image_prompt}
        attempts.append(entry)
        try:
            data = await asyncio.wait_for(p.image.generate(image_prompt), timeout=120)
            image = Blob(data=data, mime=sniff_image_mime(data))
            details = await asyncio.to_thread(image_details, image)
        except ValueError as exc:
            entry.update(usable=False, reason=str(exc))
            image_prompt += " Use a complete, high-resolution landscape image of the setting."
            continue
        except Exception as exc:
            entry.update(
                usable=False, reason="Image provider unavailable", error=type(exc).__name__
            )
            continue
        try:
            assessment = await asyncio.wait_for(
                p.vision.json(
                    system=prompt("immersive_reference_quality"),
                    messages=[{"role": "user", "content": "Intended setting: " + scene_prompt}],
                    schema=ReferenceQuality,
                    images=[image],
                ),
                timeout=60,
            )
        except Exception as exc:
            entry.update(usable=False, reason="Image review unavailable", error=type(exc).__name__)
            continue
        entry.update(assessment.model_dump())
        if assessment.usable:
            audit["image"] = details
            return image
        image_prompt += " Correct this scene issue: " + assessment.reason
    raise ValueError("Could not prepare a suitable scene image. No world generation was started.")
