"""World Labs World API v1 (Marble). Every request and response shape stays in this file.

https://docs.worldlabs.ai/api: start with `worlds:generate`, poll the operation (about 5 min),
then read the world record (`GET /worlds/{id}`) for its assets. Family photos go up as media
assets, never as public URLs.
"""

from typing import Any

import httpx

from app.config import Settings
from app.providers.base import Blob, RateLimited, WorldAssets, WorldOp

_EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


class WorldLabsWorldGen:
    def __init__(self, s: Settings) -> None:
        self._key = s.worldlabs_api_key
        self._base = s.worldlabs_base_url.rstrip("/") + "/marble/v1"
        self._model = s.worldlabs_model

    async def _call(self, method: str, path: str, body: dict[str, Any] | None = None) -> Any:
        if not self._key:
            raise RuntimeError("WORLDLABS_API_KEY is not set")
        async with httpx.AsyncClient(timeout=60) as http:
            r = await http.request(
                method, self._base + path, json=body, headers={"WLT-Api-Key": self._key}
            )
        if r.status_code == 429:
            raise RateLimited(float(r.headers.get("Retry-After") or 30))
        return r.raise_for_status().json()

    async def _upload(self, image: Blob) -> str:
        ext = _EXT.get(image.mime, "jpg")
        prepared = await self._call(
            "POST",
            "/media-assets:prepare_upload",
            {"file_name": f"photo.{ext}", "kind": "image", "extension": ext},
        )
        info = prepared["upload_info"]
        async with httpx.AsyncClient(timeout=120) as http:
            r = await http.request(
                info.get("upload_method", "PUT"),
                info["upload_url"],
                content=image.data,
                headers=info.get("required_headers") or {},
            )
        r.raise_for_status()
        return prepared["media_asset"]["media_asset_id"]

    async def start(self, *, prompt: str, image: Blob | None, display_name: str) -> str:
        if image is None:
            raise ValueError("A scene reference image is required before building a world")
        asset_id = await self._upload(image)
        world_prompt: dict[str, Any] = {
            "type": "image",
            "image_prompt": {"source": "media_asset", "media_asset_id": asset_id},
            "text_prompt": prompt,
            "is_pano": False,
        }
        op = await self._call(
            "POST",
            "/worlds:generate",
            {"display_name": display_name[:64], "model": self._model, "world_prompt": world_prompt},
        )
        return op["operation_id"]

    async def poll(self, operation_id: str) -> WorldOp:
        op = await self._call("GET", f"/operations/{operation_id}")
        error = op.get("error")
        if isinstance(error, dict):
            error = error.get("message") or str(error)
        world = op.get("response") if op.get("done") and not error else None
        if world:
            # The operation's copy leaves pano_url empty; the world record has it.
            world = await self._call("GET", f"/worlds/{world.get('world_id') or world['id']}")
            world = world.get("world", world)
        return WorldOp(
            operation_id=operation_id,
            done=bool(op.get("done")),
            error=str(error) if error else None,
            result=_assets(world) if world else None,
        )

    async def fetch(self, url: str) -> bytes:
        async with httpx.AsyncClient(timeout=300, follow_redirects=True) as http:
            r = await http.get(url)
        return r.raise_for_status().content


def _assets(world: dict[str, Any]) -> WorldAssets:
    a = world.get("assets") or {}
    splats = a.get("splats") or {}
    semantics = splats.get("semantics_metadata") or {}
    return WorldAssets(
        world_id=world.get("world_id") or world["id"],
        spz_urls=splats.get("spz_urls") or {},
        pano_url=(a.get("imagery") or {}).get("pano_url"),
        thumbnail_url=a.get("thumbnail_url"),
        collider_mesh_url=(a.get("mesh") or {}).get("collider_mesh_url"),
        caption=a.get("caption"),
        metric_scale_factor=semantics.get("metric_scale_factor"),
        ground_plane_offset=semantics.get("ground_plane_offset"),
    )
