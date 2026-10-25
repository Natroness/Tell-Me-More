"""Editing regressions: contextual assets, cache invalidation and bounded overlapping work."""

import asyncio
import json
import shutil

import pytest

from app import storage
from app.config import get_settings
from app.jobs.stages import storytime_render, storytime_script
from app.models import SceneVisual
from app.providers.base import StockPhoto
from app.storytime.common import current, update
from app.storytime.rendering import Clip, RenderPlan, captions
from app.storytime.validation import validate
from app.storytime.visuals import relevant_stock
from tests import test_storytime as shared

ask, attempt = shared.ask, shared.attempt
material, media_fakes, settings = shared.material, shared.media_fakes, shared.settings


def photo(tags, asset_id):
    return StockPhoto(
        url=f"https://pixabay.com/{asset_id}.jpg",
        width=1920,
        height=1080,
        photographer="Artist",
        page_url=f"https://pixabay.com/photos/{asset_id}",
        tags=tags,
        asset_id=asset_id,
    )


def test_stock_prefers_subject_tags_and_rejects_unrelated_images():
    unrelated = photo("mountains, snow, landscape", "1")
    partial = photo("railway, train, travel", "2")
    relevant = photo("train, railway, platform", "3")
    assert relevant_stock([unrelated, partial, relevant], "old train platform") == relevant
    assert relevant_stock([unrelated, photo("", "4")], "train platform") is None


def test_captions_follow_measured_speech_and_keep_voice_label_clear():
    plan = RenderPlan(
        [
            Clip("photo", None, 2.5),
            Clip("photo", "voice", 6, "The watch stayed with her.", voice=True, audio_seconds=5),
            Clip("photo", None, 2),
        ],
        "captions",
        "music",
        "video",
    )
    text = captions(plan, "A watch", "Grandma", [])
    assert "0:00:00.00,0:00:02.00,Card" in text
    assert "0:00:02.00,0:00:07.00,Default" in text
    assert "0:00:02.00,0:00:05.00,Badge" in text


async def test_preparation_overlaps_and_reuses_photos_without_storage_roundtrip(
    conn,
    seed,
    fakes,
    material,
    media_fakes,
    monkeypatch,
):
    # A picture cannot finish until TTS has started: sequential preparation deadlocks.
    narration_started, two_speakers = asyncio.Event(), asyncio.Event()
    active, peak = 0, 0
    original_speak, original_download = fakes.tts.speak, storage.download
    downloads, plans = [], []

    async def speak(text, **kwargs):
        nonlocal active, peak
        active += 1
        peak = max(active, peak)
        narration_started.set()
        if active == 2:
            two_speakers.set()
        await asyncio.wait_for(two_speakers.wait(), 2)
        result = await original_speak(text, **kwargs)
        active -= 1
        return result

    async def download(bucket, path):
        downloads.append((bucket, path))
        if bucket == "photos":
            await asyncio.wait_for(narration_started.wait(), 2)
        return await original_download(bucket, path)

    original_builder = storytime_render.build_ffmpeg_args

    def builder(plan):
        plans.append(plan)
        return original_builder(plan)

    monkeypatch.setattr(fakes.tts, "speak", speak)
    monkeypatch.setattr(storage, "download", download)
    monkeypatch.setattr(storytime_render, "build_ffmpeg_args", builder)
    await ask(seed)
    a = await attempt(conn, seed)
    await storytime_script.run(a)
    await storytime_render.run(a)
    assert (await current(a))["status"] == "ready"
    assert peak == 2
    assert len([b for b, _ in downloads if b == "photos"]) == 1
    assert not any(b == "generated" for b, _ in downloads)
    assert len({p.image for p in plans[0].clips}) == 1
    assert plans[0].duration == pytest.approx(8.1)
    assert all(c.audio_seconds == 1 for c in plans[0].clips if c.audio)


async def test_retry_discards_legacy_prompt_audio_but_reuses_current_audio(
    conn,
    seed,
    fakes,
    material,
    media_fakes,
):
    await ask(seed)
    a = await attempt(conn, seed)
    await storytime_script.run(a)
    legacy_path = f"{seed.family_id}/{seed.heirloom_id}/storytime/{a}/audio_0.wav"
    fakes.files[legacy_path] = b"legacy audio with spoken instructions"
    await update(a, asset={"audio_0": {"path": legacy_path, "saved": True, "seconds": 20}})
    await storytime_render.run(a)
    row = await current(a)
    assert len(fakes.tts.calls) == 2
    assert row["assets"]["audio_0"]["fingerprint"]
    assert fakes.files[legacy_path] != b"legacy audio with spoken instructions"
    await update(a, status="failed")
    await storytime_render.run(a)
    assert len(fakes.tts.calls) == 2


async def test_stock_ranking_is_used_in_the_renderer(
    conn,
    seed,
    fakes,
    material,
    media_fakes,
    monkeypatch,
):
    material["board"].scenes[1].visual = SceneVisual(
        source="stock",
        stock_query="train platform",
        prompt="A train arriving at a platform",
    )
    fakes.stock.results = [photo("mountains, snow", "1"), photo("train, platform", "2")]
    fetched = []

    async def fetch(url):
        fetched.append(url)
        return b"\x89PNG\r\n\x1a\nfake-cover"

    monkeypatch.setattr(storytime_render, "fetch_stock", fetch)
    await ask(seed)
    a = await attempt(conn, seed)
    await storytime_script.run(a)
    await storytime_render.run(a)
    assert fetched == ["https://pixabay.com/2.jpg"]
    assert not fakes.image.prompts
    assert (await current(a))["assets"]["visual_1"]["credit"]["asset_id"] == "2"


async def test_script_supplies_photo_observations_and_enforces_short_edit(
    conn,
    seed,
    fakes,
    material,
):
    await conn.execute(
        "insert into fact(heirloom_id,kind,text,source) values($1,'observation',$2,$3)",
        seed.heirloom_id,
        "A silver watch with a leather strap",
        {"kind": "observation", "media_id": str(seed.photo_id), "via": "vision"},
    )
    await ask(seed)
    await storytime_script.run(await attempt(conn, seed))
    materials = json.loads(fakes.llm.calls[-1]["messages"][0]["content"])
    assert materials["photos"][0]["observations"] == ["A silver watch with a leather strap"]
    segments = {
        material["segment"]: {
            "id": material["segment"],
            "turn_id": material["turn"],
            "narrator_id": seed.narrator_id,
            "start_ms": 0,
            "end_ms": 1000,
            "text": "I kept the watch.",
        },
    }
    long = material["board"].model_copy(deep=True)
    long.scenes *= 3
    assert validate(long, segments, {}, {seed.photo_id}, seed.narrator_id)[0] is None
    long = material["board"].model_copy(deep=True)
    for scene in (long.scenes[0], long.scenes[-1]):
        scene.narration = "She kept a watch with her every day. " * 7
    assert validate(long, segments, {}, {seed.photo_id}, seed.narrator_id)[0] is None
    # Preserve complete sentences when ASR segments are coarser than the preferred 12 seconds.
    segments[material["segment"]]["end_ms"] = 13000
    assert validate(material["board"], segments, {}, {seed.photo_id}, seed.narrator_id)[0]
    segments[material["segment"]]["end_ms"] = 21000
    assert validate(material["board"], segments, {}, {seed.photo_id}, seed.narrator_id)[0] is None


async def test_short_memory_is_not_padded_or_rejected(
    conn,
    seed,
    fakes,
    material,
    media_fakes,
    monkeypatch,
):
    monkeypatch.setattr(get_settings(), "storytime_min_seconds", 30)
    await ask(seed)
    a = await attempt(conn, seed)
    await storytime_script.run(a)
    await storytime_render.run(a)
    assert (await current(a))["status"] == "ready"


async def test_removed_during_parallel_preparation_cannot_publish_or_leak_assets(
    conn,
    seed,
    fakes,
    material,
    media_fakes,
    monkeypatch,
):
    started, release = asyncio.Event(), asyncio.Event()
    speak = fakes.tts.speak

    async def blocked(text, **kwargs):
        started.set()
        await release.wait()
        return await speak(text, **kwargs)

    monkeypatch.setattr(fakes.tts, "speak", blocked)
    await ask(seed)
    a = await attempt(conn, seed)
    await storytime_script.run(a)
    task = asyncio.create_task(storytime_render.run(a))
    await asyncio.wait_for(started.wait(), 2)
    try:
        await shared.storytime.remove(seed.heirloom_id, shared.User(id=seed.user_id))
    finally:
        release.set()
        await task
    assert await current(a) is None
    assert not any("/storytime/" in p for p in fakes.files)


async def test_real_render_stage_with_seven_scenes(conn, seed, fakes, material, tmp_path):
    s = get_settings()
    if not shutil.which(s.ffmpeg_binary) or not shutil.which(s.ffprobe_binary):
        pytest.skip("ffmpeg required")
    # Five context scenes, plus title/credits, exercise repeated chained xfade filters.
    material["board"].scenes.insert(1, material["board"].scenes[0].model_copy(deep=True))
    material["board"].scenes.insert(-1, material["board"].scenes[-1].model_copy(deep=True))
    photo_path = await conn.fetchval("select storage_path from media where id=$1", seed.photo_id)
    fakes.files[photo_path] = shared.png()
    await ask(seed)
    a = await attempt(conn, seed)
    await storytime_script.run(a)
    await storytime_render.run(a)
    row = await current(a)
    assert row["status"] == "ready"
    video = tmp_path / "rendered.mp4"
    video.write_bytes(fakes.files[row["assets"]["video"]["path"]])
    probe = json.loads(
        await storytime_render.execute(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_streams",
                "-show_format",
                "-of",
                "json",
                str(video),
            ]
        )
    )
    assert 10 < float(probe["format"]["duration"]) < 11
    assert abs(row["duration_ms"] / 1000 - float(probe["format"]["duration"])) < 0.05
    streams = {stream["codec_type"]: stream for stream in probe["streams"]}
    assert streams["video"]["codec_name"] == "h264"
    assert streams["video"]["r_frame_rate"] == "24/1"
    assert (streams["video"]["width"], streams["video"]["height"]) == (1280, 720)
    assert streams["audio"]["codec_name"] == "aac"
