"""Bounded stock discovery, cached for 24 hours. No connection held across HTTP calls."""

import asyncio
import hashlib

import httpx

from app.config import Settings
from app.db import pool
from app.providers.base import StockPhoto


class Pixabay:
    def __init__(self, s: Settings, *, cache: bool = True) -> None:
        self._key = s.pixabay_api_key
        self._cache = cache

    async def search(self, query: str, *, orientation: str = "landscape") -> list[StockPhoto]:
        if not self._key:
            return []
        params = {
            "q": query[:100],
            "image_type": "photo",
            "orientation": "horizontal" if orientation == "landscape" else "vertical",
            "safesearch": "true",
            "per_page": "8",
        }
        key = "pixabay:" + hashlib.sha256(str(sorted(params.items())).encode()).hexdigest()
        data = None
        if self._cache:
            async with pool().acquire() as conn:
                data = await conn.fetchval(
                    "select response from serp_cache where key = $1 "
                    "and created_at > now() - interval '24 hours'",
                    key,
                )
        if data is None:
            async with httpx.AsyncClient(timeout=30) as http:
                for attempt in range(6):
                    r = await http.get(
                        "https://pixabay.com/api/", params={**params, "key": self._key}
                    )
                    if r.status_code != 429:
                        break
                    await asyncio.sleep(min(60, float(r.headers.get("Retry-After", 2**attempt))))
            if r.is_error:
                # The key is a query parameter: never propagate HTTPStatusError's URL.
                raise RuntimeError(f"Pixabay search failed (HTTP {r.status_code})")
            data = r.json()
            if self._cache:
                async with pool().acquire() as conn:
                    await conn.execute(
                        "insert into serp_cache (key, params, response) values ($1, $2, $3) "
                        "on conflict (key) do update set response = excluded.response, "
                        "created_at = now()",
                        key,
                        params,
                        data,
                    )
        return [
            StockPhoto(
                url=h["largeImageURL"],
                width=h["imageWidth"],
                height=h["imageHeight"],
                photographer=h["user"],
                page_url=h["pageURL"],
                asset_id=str(h["id"]),
                tags=h.get("tags", ""),
            )
            for h in data.get("hits", [])
            if h.get("largeImageURL")
            and h["imageWidth"] >= 1280
            and h["imageWidth"] > h["imageHeight"]
        ]
