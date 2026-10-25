"""Live checks against every external service Lorebook depends on (DESIGN.md §7).

Run: `make check` (or `uv run python -m scripts.check_services` from backend/).
Prints PASS/FAIL per check with latency. Secrets are redacted from all output.
"""

import argparse
import asyncio
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any
from uuid import uuid4

import asyncpg
import httpx
from pydantic import BaseModel

from app import storage
from app.config import get_settings
from app.jobs.stages.common import sniff_image_mime
from app.providers.base import Blob
from app.providers.gemini import GeminiLLM
from app.providers.gemini_tts import GeminiTTS
from app.providers.meta import MetaASR, MetaImage, MetaLLM
from app.providers.pixabay import Pixabay
from app.providers.serpapi import SerpApi

S = get_settings()
SECRETS = [
    v
    for v in (
        S.database_url,
        S.supabase_secret_key,
        S.meta_api_key,
        S.gemini_api_key,
        S.serpapi_key,
        S.pixabay_api_key,
    )
    if v
]
FRONTEND_DIR = Path(__file__).parents[2] / "frontend"
SPOKEN = "My grandmother gave me this watch in nineteen sixty one. It still ticks."

results: list[tuple[str, bool, float, str]] = []
shared: dict[str, Any] = {}


def redact(text: str) -> str:
    for secret in SECRETS:
        text = text.replace(secret, "***")
    return text


async def check(name: str, fn: Callable[[], Awaitable[str]]) -> None:
    start = time.perf_counter()
    try:
        detail, ok = await fn(), True
    except Exception as e:
        detail, ok = f"{type(e).__name__}: {e}", False
        if "-v" in sys.argv:
            traceback.print_exc()
    elapsed = time.perf_counter() - start
    results.append((name, ok, elapsed, redact(detail)))
    print(f"{'PASS' if ok else 'FAIL'}  {name:<28} {elapsed:6.2f}s  {redact(detail)[:300]}")


def frontend_publishable_key() -> str:
    """Same precedence as Vite: .env.local overrides .env, even with an empty value."""
    value = ""
    for name in (".env", ".env.local"):
        path = FRONTEND_DIR / name
        for line in path.read_text().splitlines() if path.exists() else []:
            if line.startswith("VITE_SUPABASE_PUBLISHABLE_KEY="):
                value = line.split("=", 1)[1].strip()
    return value


# Database -----------------------------------------------------------------------------------


async def db_schema() -> str:
    conn = await asyncpg.connect(S.database_url, statement_cache_size=0, timeout=15)
    try:
        q = conn.fetchval
        tables = await conn.fetch(
            "select tablename, rowsecurity from pg_tables where schemaname = 'public'"
        )
        no_rls = [t["tablename"] for t in tables if not t["rowsecurity"]]
        private = await q("select exists(select 1 from pg_namespace where nspname = 'private')")
        public_helpers = await q(
            "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
            "where n.nspname = 'public' and proname in "
            "('is_member', 'heirloom_family', 'interview_family')"
        )
        realtime = await q(
            "select string_agg(tablename, ',' order by tablename) from pg_publication_tables "
            "where pubname = 'supabase_realtime'"
        )
        buckets = await q(
            "select string_agg(id || case when public then '(PUBLIC!)' else '' end, ',' "
            "order by id) from storage.buckets where id in ('photos', 'audio', 'generated')"
        )
        anon_grants = await q(
            "select count(*) from information_schema.role_table_grants "
            "where grantee = 'anon' and table_schema = 'public'"
        )
    finally:
        await conn.close()
    problems = []
    if len(tables) < 15:
        problems.append(f"only {len(tables)} public tables")
    if no_rls:
        problems.append(f"RLS off: {no_rls}")
    if not private or public_helpers:
        problems.append("old migration version (helpers in public, no private schema)")
    required_realtime = {"interview", "job", "memory_note", "story", "turn", "storytime"}
    if not required_realtime.issubset(set((realtime or "").split(","))):
        problems.append(f"realtime tables: {realtime}")
    if buckets != "audio,generated,photos":
        problems.append(f"buckets: {buckets}")
    if anon_grants:
        problems.append(f"anon has {anon_grants} table grants")
    if problems:
        raise AssertionError("; ".join(problems))
    return f"{len(tables)} tables, RLS on, private helpers, realtime={realtime}, buckets={buckets}"


# Storage ------------------------------------------------------------------------------------


async def storage_roundtrip() -> str:
    data = b"lorebook-healthcheck-" + uuid4().bytes
    path = f"_healthcheck/{uuid4()}.txt"
    await storage.upload("generated", path, data, "text/plain")
    try:
        assert await storage.download("generated", path) == data, "download mismatch"
        signed = await storage.signed_download_url("generated", path, expires_in=60)
        async with httpx.AsyncClient(timeout=15) as http:
            r = await http.get(signed)
        assert r.status_code == 200 and r.content == data, f"signed GET {r.status_code}"
    finally:
        await _delete("generated", [path])
    return "upload, download, signed GET with no key all OK"


async def storage_browser_upload() -> str:
    key = frontend_publishable_key()
    if not key:
        raise AssertionError("VITE_SUPABASE_PUBLISHABLE_KEY is empty (frontend/.env or .env.local)")
    path = f"_healthcheck/{uuid4()}.wav"
    url = await storage.signed_upload_url("audio", path)
    data = b"RIFF-fake-" + uuid4().bytes
    try:
        async with httpx.AsyncClient(timeout=15) as http:
            r = await http.put(
                url,
                content=data,
                headers={"Content-Type": "audio/wav", "x-upsert": "true", "apikey": key},
            )
        assert r.status_code in (200, 201), f"PUT {r.status_code}: {r.text[:200]}"
        assert await storage.download("audio", path) == data, "uploaded bytes mismatch"
    finally:
        await _delete("audio", [path])
    return "signed upload URL + publishable key PUT works (same as the phone)"


async def _delete(bucket: str, paths: list[str]) -> None:
    async with httpx.AsyncClient(timeout=15) as http:
        await http.request(
            "DELETE",
            f"{S.supabase_url}/storage/v1/object/{bucket}",
            headers={"apikey": S.supabase_secret_key},
            json={"prefixes": paths},
        )


# Meta ---------------------------------------------------------------------------------------


class Ping(BaseModel):
    reply: str
    number: int


class Sight(BaseModel):
    object: str
    details: list[str]


async def meta_chat() -> str:
    out = await MetaLLM(S).json(
        system="Answer in JSON only.",
        messages=[{"role": "user", "content": "Say hello and give the number 42."}],
        schema=Ping,
    )
    assert out.number == 42, f"number={out.number}"
    return f"{S.meta_chat_model}: {out.reply!r}"


async def meta_image() -> str:
    png = await MetaImage(S).generate(
        "A realistic photo of an antique gold pocket watch with an engraved lid, "
        "resting on a worn wooden table, soft daylight"
    )
    assert len(png) > 1000, f"only {len(png)} bytes"
    shared["image"] = png
    out = Path(tempfile.gettempdir()) / "lorebook_check_watch.png"
    out.write_bytes(png)
    return f"{S.meta_image_model}: {len(png) // 1024} KB image ({out})"


async def _vision(llm: Any, label: str) -> str:
    if "image" not in shared:
        raise AssertionError("skipped: no test image (image generation failed)")
    out = await llm.json(
        system="Describe only what is visible. JSON only.",
        messages=[{"role": "user", "content": "What object is this? List 3 visible details."}],
        schema=Sight,
        images=[Blob(data=shared["image"], mime=sniff_image_mime(shared["image"]))],
    )
    return f"{label}: {out.object!r} / {out.details[:3]}"


async def meta_vision() -> str:
    return await _vision(MetaLLM(S), S.meta_chat_model)


async def gemini_vision() -> str:
    if not S.gemini_api_key:
        raise AssertionError("skipped: GEMINI_API_KEY empty")
    return await _vision(GeminiLLM(S), S.gemini_model)


def _spoken_wav(text: str = SPOKEN) -> bytes:
    """Real speech via macOS `say`, converted to 16 kHz mono WAV like the phone records."""
    with tempfile.TemporaryDirectory() as d:
        aiff, wav = Path(d) / "s.aiff", Path(d) / "s.wav"
        subprocess.run(["say", "-o", str(aiff), text], check=True)
        subprocess.run(
            ["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", str(aiff), str(wav)],
            check=True,
        )
        return wav.read_bytes()


async def meta_asr() -> str:
    audio = await asyncio.to_thread(_spoken_wav)
    t = await MetaASR(S).transcribe(audio=Blob(data=audio, mime="audio/wav"), language="en")
    stamps = f"{len(t.segments)} timed segments" if t.segments else "NO timestamps"
    return f"{S.meta_asr_model}: {t.text!r} ({stamps})"


# SerpApi ------------------------------------------------------------------------------------


async def serpapi_lens() -> str:
    if "image" not in shared:
        raise AssertionError("skipped: no test image (image generation failed)")
    path = f"_healthcheck/{uuid4()}.png"
    await storage.upload("photos", path, shared["image"], sniff_image_mime(shared["image"]))
    try:
        url = await storage.signed_download_url("photos", path, expires_in=300)
        matches = await SerpApi(S, cache=False).lens(url)
    finally:
        await _delete("photos", [path])
    assert matches, "no visual matches"
    return f"{len(matches)} matches, top: {[m.title for m in matches[:3]]}"


async def storytime_media() -> str:
    assert shutil.which(S.ffmpeg_binary) and shutil.which(S.ffprobe_binary), (
        "Install ffmpeg/ffprobe or set FFMPEG_BINARY and FFPROBE_BINARY"
    )
    result = await asyncio.to_thread(
        subprocess.run,
        [S.ffmpeg_binary, "-hide_banner", "-filters"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, "FFmpeg cannot start; check FFMPEG_BINARY and its libraries"
    assert all(
        name in result.stdout for name in ("zoompan", "xfade", "subtitles", "sidechaincompress")
    )
    return "ffmpeg + ffprobe, zoompan, xfade, libass subtitles and music ducking available"


async def storytime_tts() -> str:
    blob = await GeminiTTS(S).speak("Her family kept the watch as a reminder of home.")
    assert blob.data.startswith(b"RIFF"), "Narration is not a WAV file"
    return f"{S.tts_model}, fixed {S.tts_voice} English voice, {len(blob.data)} bytes"


async def storytime_stock() -> str:
    photos = await Pixabay(S, cache=False).search("old pocket watch")
    assert photos, "No landscape stock results; check PIXABAY_API_KEY"
    return f"{len(photos)} usable images; first credit: {photos[0].photographer} / Pixabay"


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--storytime", action="store_true", help="Also probe English TTS and Pixabay"
    )
    parser.add_argument(
        "--storytime-only", action="store_true", help="Probe only Storytime services"
    )
    parser.add_argument("-v", action="store_true")
    args = parser.parse_args()
    await check("storytime: media tools", storytime_media)
    if args.storytime or args.storytime_only:
        await check("storytime: English narration", storytime_tts)
        await check("storytime: Pixabay stock", storytime_stock)
    if args.storytime_only:
        if any(not ok for _, ok, _, _ in results):
            raise SystemExit(1)
        return
    await check("db: schema + RLS + buckets", db_schema)
    await check("storage: server roundtrip", storage_roundtrip)
    await check("storage: browser upload", storage_browser_upload)
    await check("meta: chat (json schema)", meta_chat)
    await check("meta: image generation", meta_image)
    await check("meta: vision", meta_vision)
    await check("meta: transcribe", meta_asr)
    await check("gemini: vision (fallback)", gemini_vision)
    await check("serpapi: google lens", serpapi_lens)
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
