import hashlib
import json
from typing import Any, Literal

import httpx

from app.config import Settings
from app.db import pool
from app.providers.base import LensMatch, SerpResult

_URL = "https://serpapi.com/search.json"


class SerpApi:
    """Responses are cached in `serp_cache` to save quota and keep demos repeatable."""

    def __init__(self, s: Settings, *, cache: bool = True) -> None:
        self._key = s.serpapi_key
        self._cache = cache

    async def _fetch(self, params: dict[str, str]) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=30) as http:
            r = await http.get(_URL, params={**params, "api_key": self._key})
        return r.raise_for_status().json()

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
