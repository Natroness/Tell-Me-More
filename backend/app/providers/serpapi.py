import hashlib
import json
from typing import Any, Literal
from urllib.parse import urlencode

import httpx

from app.config import Settings
from app.db import pool
from app.providers.base import ImageResult, LensMatch, SerpResult

_URL = "https://serpapi.com/search.json"


class SerpApi:
    """Responses are cached in `serp_cache` to save quota and keep demos repeatable."""

    def __init__(self, s: Settings, *, cache: bool = True) -> None:
        self._key = s.serpapi_key
        self._cache = cache

    async def _fetch(self, params: dict[str, str]) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=90) as http:
            r = await http.get(_URL, params={**params, "api_key": self._key})
        if r.is_error:
            # API keys are query parameters; HTTPStatusError would print the complete URL.
            raise RuntimeError(f"Image/search request failed (HTTP {r.status_code})")
        data = r.json()
        if data.get("error"):
            raise RuntimeError("Search provider returned an error")
        return data

    async def _search(self, params: dict[str, str]) -> dict[str, Any]:
        if not self._cache:
            return await self._fetch(params)
        cache_key = hashlib.sha256(json.dumps(params, sort_keys=True).encode()).hexdigest()
        async with pool().acquire() as conn:
            cached = await conn.fetchval(
                "select response from serp_cache where key = $1", cache_key
            )
            if cached is not None:
                return cached
        data = await self._fetch(params)
        async with pool().acquire() as conn:
            await conn.execute(
                "insert into serp_cache (key, params, response) values ($1, $2, $3) "
                "on conflict (key) do nothing",
                cache_key,
                params,
                data,
            )
            return data

    async def lens(self, image_url: str) -> list[LensMatch]:
        data = await self._search({"engine": "google_lens", "url": image_url})
        return [
            LensMatch(
                title=m.get("title", ""),
                link=m["link"],
                source=m.get("source"),
                thumbnail=m.get("thumbnail"),
            )
            for m in data.get("visual_matches", [])
            if m.get("link")
        ]

    async def web(
        self, q: str, engine: Literal["google", "google_news"] = "google"
    ) -> list[SerpResult]:
        data = await self._search({"engine": engine, "q": q})
        key = "organic_results" if engine == "google" else "news_results"
        return [
            SerpResult(
                title=r.get("title", ""),
                link=r["link"],
                snippet=r.get("snippet"),
                date=r.get("date"),
            )
            for r in data.get(key, [])
            if r.get("link")
        ]

    async def images(self, q: str) -> list[ImageResult]:
        data = await self._search({"engine": "google_images", "q": q})
        return [
            ImageResult(
                url=r["original"],
                page_url=r.get("link") or r["original"],
                title=r.get("title", ""),
                width=r.get("original_width"),
                via="google_images",
            )
            for r in data.get("images_results", [])
            if r.get("original")
        ]

    async def place_photos(self, place: str) -> list[ImageResult]:
        found = await self._search({"engine": "google_maps", "type": "search", "q": place})
        spot = found.get("place_results") or next(iter(found.get("local_results") or []), None)
        if not spot or not spot.get("data_id"):
            return []
        params = {"engine": "google_maps_photos", "data_id": spot["data_id"]}
        data = await self._search(params)
        inside = next(
            (c["id"] for c in data.get("categories", []) if c.get("title") == "Inside"), None
        )
        if inside:
            data = await self._search({**params, "category_id": inside})
        name = " ".join(filter(None, [spot.get("title"), spot.get("address")])) or place
        page = "https://www.google.com/maps/search/?" + urlencode({"api": 1, "query": name})
        return [
            ImageResult(
                url=p["image"],
                page_url=page,
                title=spot.get("title", place),
                via="google_maps",
            )
            for p in data.get("photos", [])
            if p.get("image") and not p.get("video")
        ]
