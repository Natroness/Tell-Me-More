"""Supabase Storage via its REST API. Object paths start with the family id so storage RLS can
check membership: `{family_id}/{heirloom_id}/{media_id}.{ext}`."""

from typing import Literal
from uuid import UUID

import httpx

from app.config import get_settings

Bucket = Literal["photos", "audio", "generated"]

_EXT = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "video/webm": "webm",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
    "audio/wav": "wav",
}


def object_path(family_id: UUID, heirloom_id: UUID, media_id: UUID, mime: str) -> str:
    return f"{family_id}/{heirloom_id}/{media_id}.{_EXT.get(mime.split(';')[0], 'bin')}"


def world_path(family_id: UUID, heirloom_id: UUID, world_id: UUID, name: str, ext: str) -> str:
    """Where an immersive world's files live in the `generated` bucket."""
    return f"{family_id}/{heirloom_id}/worlds/{world_id}/{name}.{ext}"


def storytime_path(
    family_id: UUID, heirloom_id: UUID, attempt_id: UUID, name: str, ext: str
) -> str:
    return f"{family_id}/{heirloom_id}/storytime/{attempt_id}/{name}.{ext}"


async def remove(bucket: Bucket, paths: list[str]) -> None:
    if not paths:
        return
    base = f"{get_settings().supabase_url}/storage/v1"
    async with httpx.AsyncClient(timeout=60) as http:
        r = await http.request(
            "DELETE", f"{base}/object/{bucket}", headers=_headers(), json={"prefixes": paths}
        )
    r.raise_for_status()


def _headers() -> dict[str, str]:
    # New sb_secret_ keys aren't JWTs: they go on `apikey` only, never `Authorization: Bearer`.
    return {"apikey": get_settings().supabase_secret_key}


async def signed_upload_url(bucket: Bucket, path: str) -> str:
    """The browser PUTs the file body to this URL."""
    base = f"{get_settings().supabase_url}/storage/v1"
    async with httpx.AsyncClient(timeout=15) as http:
        r = await http.post(f"{base}/object/upload/sign/{bucket}/{path}", headers=_headers())
    return base + r.raise_for_status().json()["url"]


async def signed_download_url(bucket: Bucket, path: str, expires_in: int = 3600) -> str:
    base = f"{get_settings().supabase_url}/storage/v1"
    async with httpx.AsyncClient(timeout=15) as http:
        r = await http.post(
            f"{base}/object/sign/{bucket}/{path}",
            headers=_headers(),
            json={"expiresIn": expires_in},
        )
    return base + r.raise_for_status().json()["signedURL"]


async def download(bucket: Bucket, path: str) -> bytes:
    base = f"{get_settings().supabase_url}/storage/v1"
    async with httpx.AsyncClient(timeout=60) as http:
        r = await http.get(f"{base}/object/{bucket}/{path}", headers=_headers())
    return r.raise_for_status().content


async def upload(bucket: Bucket, path: str, data: bytes, mime: str) -> None:
    base = f"{get_settings().supabase_url}/storage/v1"
    async with httpx.AsyncClient(timeout=60) as http:
        r = await http.post(
            f"{base}/object/{bucket}/{path}",
            headers={**_headers(), "Content-Type": mime, "x-upsert": "true"},
            content=data,
        )
    r.raise_for_status()
