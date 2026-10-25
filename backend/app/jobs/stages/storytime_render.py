"""Resumable English slideshow generation. Never holds a DB connection across external work."""

import asyncio
import logging
import tempfile
from pathlib import Path
from uuid import UUID, uuid4

import httpx

from app import providers, storage
from app.config import get_settings
from app.db import pool
from app.jobs.stages.common import sniff_image_mime
from app.models import NarrationScene, Storyboard
from app.storytime.common import Superseded, current, load_story, update
from app.storytime.rendering import Clip, RenderPlan, build_ffmpeg_args, captions, duration, execute

log = logging.getLogger(__name__)
ENCODER = asyncio.Semaphore(1)
MUSIC = Path(__file__).parents[2] / "assets" / "music"


async def fetch_stock(url: str) -> bytes:
    from urllib.parse import urlparse

    host = urlparse(url).hostname or ""
    if urlparse(url).scheme != "https" or not (
        host == "pixabay.com" or host.endswith(".pixabay.com")
    ):
        raise ValueError("Unexpected stock image host")
    async with httpx.AsyncClient(timeout=30) as http:
        r = await http.get(url)
    if r.is_error or not r.headers.get("Content-Type", "").startswith("image/"):
        raise RuntimeError("Could not download the stock image")
    return r.content


async def save_asset(row, name: str, data: bytes, mime: str, **metadata):
    ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "audio/wav": "wav"}[mime]
    path = storage.storytime_path(
        row["family_id"], row["heirloom_id"], row["generation_id"], name, ext
    )
    # Register before upload: Remove can clean it even when it races with an upload.
    await update(row["generation_id"], asset={name: {"path": path, **metadata}})
    await storage.upload("generated", path, data, mime)
    try:
        await update(row["generation_id"], asset={name: {"path": path, "saved": True, **metadata}})
    except Superseded:
        await storage.remove("generated", [path])
        raise
    return {"path": path, "saved": True, **metadata}


async def run(attempt_id: UUID) -> None:
    row = await current(attempt_id)
    if row is None or row["status"] == "ready":
        return
    try:
        board = Storyboard.model_validate(row["storyboard"])
        async with pool().acquire() as conn:
            story = await load_story(conn, row["story_id"])
            photos = {
                p["id"]: p["storage_path"]
                for p in await conn.fetch(
                    "select id,storage_path from media where heirloom_id = $1 and kind = 'photo'",
                    row["heirloom_id"],
                )
            }
            segments = {
                s["id"]: dict(s)
                for s in await conn.fetch(
                    "select s.*,t.audio_media_id,i.narrator_id,m.storage_path from segment s "
                    "join turn t on t.id = s.turn_id join interview i on i.id = t.interview_id "
                    "join media m on m.id = t.audio_media_id "
                    "where i.heirloom_id = $1 and i.language = 'en'",
                    row["heirloom_id"],
                )
            }
        if story is None:
            raise ValueError("The source story is no longer available")
        narrator = story["narrator_name"] or "the storyteller"
        assets = dict(row["assets"])
        semaphore = asyncio.Semaphore(3)
        await update(attempt_id, status="gathering")

        async def visual(index, scene):
            name = f"visual_{index}"
            if assets.get(name, {}).get("saved"):
                return
            async with semaphore:
                if await current(attempt_id) is None:
                    raise Superseded()
                v = scene.visual
                credit = None
                source = v.source
                if v.source == "family_photo" and v.media_id in photos:
                    data = await storage.download("photos", photos[v.media_id])
                else:
                    data = None
                    if v.source == "stock":
                        try:
                            matches = await providers.get_providers().stock.search(
                                v.stock_query or "family keepsake"
                            )
                            if matches:
                                photo = matches[0]
                                data = await fetch_stock(photo.url)
                                credit = photo.model_dump(exclude={"url", "width", "height"})
                        except Exception:
                            log.info("Stock unavailable; using an illustration")
                    if data is None:
                        source = "generated"
                        prompt = v.prompt or v.stock_query or "A treasured family object"
                        data = await providers.get_providers().image.generate(
                            prompt + ". Painterly illustration, soft light, muted earthy palette. "
                            "No recognizable real family faces, no text or letters."
                        )
                assets[name] = await save_asset(
                    row, name, data, sniff_image_mime(data), credit=credit, source=source
                )

        results = await asyncio.gather(
            *(visual(i, s) for i, s in enumerate(board.scenes)), return_exceptions=True
        )
        for result in results:
            if isinstance(result, BaseException):
                raise result
        await update(attempt_id, status="narrating")
        with tempfile.TemporaryDirectory(prefix="storytime-") as temp:
            work = Path(temp)
            clips = []
            for index, scene in enumerate(board.scenes):
                if await current(attempt_id) is None:
                    raise Superseded()
                name = f"audio_{index}"
                audio_path = work / f"audio-{index}.wav"
                if assets.get(name, {}).get("saved"):
                    audio_path.write_bytes(
                        await storage.download("generated", assets[name]["path"])
                    )
                elif isinstance(scene, NarrationScene):
                    blob = await providers.get_providers().tts.speak(scene.narration, language="en")
                    audio_path.write_bytes(blob.data)
                else:
                    selected = [segments[s] for s in scene.segment_ids]
                    if (
                        any(s["narrator_id"] != story["narrator_id"] for s in selected)
                        or len({s["turn_id"] for s in selected}) != 1
                    ):
                        raise ValueError("Original voice clip is no longer valid")
                    source_path = work / "source.wav"
                    source_path.write_bytes(
                        await storage.download("audio", selected[0]["storage_path"])
                    )
                    start = max(0, selected[0]["start_ms"] - 150) / 1000
                    stop = (selected[-1]["end_ms"] + 150) / 1000
                    await execute(
                        [
                            "ffmpeg",
                            "-hide_banner",
                            "-loglevel",
                            "error",
                            "-y",
                            "-i",
                            str(source_path),
                            "-ss",
                            str(start),
                            "-t",
                            str(stop - start),
                            "-ac",
                            "1",
                            "-ar",
                            "24000",
                            str(audio_path),
                        ]
                    )
                seconds = await duration(audio_path)
                if not assets.get(name, {}).get("saved"):
                    assets[name] = await save_asset(
                        row, name, audio_path.read_bytes(), "audio/wav", seconds=seconds
                    )
                image_path = work / f"image-{index}"
                image_path.write_bytes(
                    await storage.download("generated", assets[f"visual_{index}"]["path"])
                )
                voice = not isinstance(scene, NarrationScene)
                text = (
                    scene.narration
                    if not voice
                    else " ".join(segments[s]["text"] for s in scene.segment_ids)
                )
                clips.append(
                    Clip(
                        str(image_path),
                        str(audio_path),
                        seconds + (1.2 if voice else 0.8) + 0.7,
                        text,
                        scene.visual.motion,
                        voice,
                    )
                )
            plan = RenderPlan(
                [Clip(clips[0].image, None, 4.7), *clips, Clip(clips[-1].image, None, 4)],
                str(work / "captions.ass"),
                str(MUSIC / f"{board.mood}.wav"),
                str(work / "video.mp4"),
            )
            s = get_settings()
            if plan.duration > s.storytime_max_seconds:
                raise ValueError("The script is too long. Please regenerate a shorter video.")
            if plan.duration < s.storytime_min_seconds:
                # Short scripts cannot become a minute of silent padding.
                extra = (s.storytime_min_seconds - plan.duration) / len(clips)
                if extra > 3:
                    raise ValueError(
                        "Not enough story for a one-minute video yet. Add another memory."
                    )
                from dataclasses import replace

                clips = [replace(c, seconds=c.seconds + extra) for c in clips]
                plan = replace(plan, clips=[plan.clips[0], *clips, plan.clips[-1]])
            credits = [
                a["credit"] for a in assets.values() if isinstance(a, dict) and a.get("credit")
            ]
            credit_labels = list(
                dict.fromkeys(f"Photo: {c['photographer']} / {c['provider']}" for c in credits)
            )
            await asyncio.to_thread(
                Path(plan.captions).write_text, captions(plan, board.title, narrator, credit_labels)
            )
            await update(attempt_id, status="rendering")
            async with ENCODER:
                if await current(attempt_id) is None:
                    raise Superseded()
                await execute(build_ffmpeg_args(plan))
            final_seconds = await duration(Path(plan.output))
            poster = work / "poster.jpg"
            await execute(
                [
                    "ffmpeg",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-i",
                    plan.output,
                    "-frames:v",
                    "1",
                    str(poster),
                ]
            )
            video_path = storage.storytime_path(
                row["family_id"], row["heirloom_id"], attempt_id, "video", "mp4"
            )
            poster_path = storage.storytime_path(
                row["family_id"], row["heirloom_id"], attempt_id, "poster", "jpg"
            )
            await update(
                attempt_id,
                asset={
                    "video": {"path": video_path},
                    "poster": {"path": poster_path},
                    "credits": credits,
                },
            )
            await storage.upload(
                "generated",
                video_path,
                await asyncio.to_thread(Path(plan.output).read_bytes),
                "video/mp4",
            )
            await storage.upload("generated", poster_path, poster.read_bytes(), "image/jpeg")
            try:
                await _finish(
                    row, video_path, poster_path, round(final_seconds * 1000), story["narrator_id"]
                )
            except Superseded:
                await storage.remove("generated", [video_path, poster_path])
                raise
    except Superseded:
        return
    except Exception as exc:
        try:
            message = (
                str(exc)
                if isinstance(exc, ValueError)
                else "Could not finish the video. Please retry."
            )
            await update(attempt_id, status="failed", error=message[:250])
        except Superseded:
            return
        raise


async def _finish(row, video_path: str, poster_path: str, duration_ms: int, narrator_id: UUID):
    async with pool().acquire() as conn:
        async with conn.transaction():
            active = await conn.fetchrow(
                "select id from storytime where generation_id = $1 for update", row["generation_id"]
            )
            if active is None:
                raise Superseded()
            video_id, poster_id = uuid4(), uuid4()
            for media_id, kind, path, mime in (
                (video_id, "generated_video", video_path, "video/mp4"),
                (poster_id, "generated_image", poster_path, "image/jpeg"),
            ):
                await conn.execute(
                    "insert into "
                    "media(id,family_id,heirloom_id,kind,storage_path,mime,duration_ms) "
                    "values($1,$2,$3,$4,$5,$6,$7)",
                    media_id,
                    row["family_id"],
                    row["heirloom_id"],
                    kind,
                    path,
                    mime,
                    duration_ms if kind == "generated_video" else None,
                )
            await conn.execute(
                "update storytime set video_media_id=$2,poster_media_id=$3,video_story_id=story_id,"
                "duration_ms=$4,status='ready',error=null,updated_at=now() where generation_id=$1",
                row["generation_id"],
                video_id,
                poster_id,
                duration_ms,
            )
            await conn.execute(
                "insert into notification(recipient_id,type,story_id,request_id) "
                "select distinct p.id,'storytime_ready',s.id,s.request_id from story s "
                "left join story_request r on r.id=s.request_id "
                "join person p on p.family_id=$3 and (p.id=$4 or p.id=r.listener_id "
                "or p.id in (select person_id from member where user_id=$2 and family_id=$3)) "
                "where s.id=$1",
                row["story_id"],
                row["requested_by"],
                row["family_id"],
                narrator_id,
            )
