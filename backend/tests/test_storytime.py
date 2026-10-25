import asyncio
import struct
import zlib
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi import HTTPException, Response

from app.auth import User
from app.config import get_settings
from app.jobs.stages import storytime_render, storytime_script
from app.models import NarrationScene, SceneVisual, SegmentCite, Storyboard, VoiceScene
from app.routers import storytime
from app.storytime.common import Superseded, current, update
from app.storytime.rendering import Clip, RenderPlan, build_ffmpeg_args, captions, duration, execute
from app.storytime.validation import validate
from tests.conftest import make_wav


@pytest.fixture(autouse=True)
def settings(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "storytime_enabled", True)
    monkeypatch.setattr(s, "gemini_api_key", "test-key")
    monkeypatch.setattr(s, "storytime_min_seconds", 1)
    monkeypatch.setattr(storytime, "available", lambda: s.storytime_enabled)


@pytest.fixture
async def material(conn, seed, fakes):
    interview = await conn.fetchval(
        "insert into "
        "interview(heirloom_id,narrator_id,interviewer_user_id) values($1,$2,$3) returning id",
        seed.heirloom_id,
        seed.narrator_id,
        seed.user_id,
    )
    audio_path = f"{seed.family_id}/{seed.heirloom_id}/answer.wav"
    audio = await conn.fetchval(
        "insert into media(family_id,heirloom_id,kind,storage_path,mime) "
        "values($1,$2,'audio',$3,'audio/wav') returning id",
        seed.family_id,
        seed.heirloom_id,
        audio_path,
    )
    turn = await conn.fetchval(
        "insert into turn(interview_id,idx,role,audio_media_id) "
        "values($1,1,'answer',$2) returning id",
        interview,
        audio,
    )
    segment = await conn.fetchval(
        "insert into segment(turn_id,start_ms,end_ms,text) "
        "values($1,0,1000,'I kept the watch.') returning id",
        turn,
    )
    story = await conn.fetchval(
        "insert into "
        "story(heirloom_id,version,title,blocks,storyteller_id) "
        "values($1,1,'The family watch','[]',$2) returning id",
        seed.heirloom_id,
        seed.narrator_id,
    )
    fakes.files[audio_path] = make_wav(1)
    photo = SceneVisual(source="family_photo", media_id=seed.photo_id)
    board = Storyboard(
        title="The family watch",
        mood="tender",
        scenes=[
            NarrationScene(
                type="narration",
                narration="She kept the watch.",
                cites=[SegmentCite(kind="segment", segment_id=segment)],
                visual=photo,
            ),
            VoiceScene(type="voice", segment_ids=[segment], visual=photo),
            NarrationScene(
                type="narration",
                narration="The watch stayed with her.",
                cites=[SegmentCite(kind="segment", segment_id=segment)],
                visual=photo,
            ),
        ],
    )
    fakes.llm.responses[Storyboard] = board
    return {"segment": segment, "story": story, "turn": turn, "board": board}


async def ask(seed, user=None):
    response = Response()
    data = await storytime.create(seed.heirloom_id, User(id=user or seed.user_id), response)
    return data, response.status_code


async def attempt(conn, seed):
    return await conn.fetchval(
        "select generation_id from storytime where heirloom_id=$1", seed.heirloom_id
    )


@pytest.fixture
def media_fakes(monkeypatch):
    async def fake_execute(args, **kwargs):
        await asyncio.to_thread(Path(args[-1]).write_bytes, b"fake media")
        return b""

    async def fake_duration(path):
        return 1.0

    monkeypatch.setattr(storytime_render, "execute", fake_execute)
    monkeypatch.setattr(storytime_render, "duration", fake_duration)


async def test_create_is_opt_in_idempotent_and_ledger_is_private(conn, fakes, seed, material):
    assert await conn.fetchval("select count(*) from job where kind like 'storytime_%'") == 0
    first, code = await ask(seed)
    second, again = await ask(seed)
    assert (code, again, first.id == second.id) == (202, 200, True)
    assert await conn.fetchval("select count(*) from storytime_attempt") == 1
    async with conn.transaction():
        await conn.execute("select set_config('request.jwt.claim.sub',$1,true)", str(seed.user_id))
        await conn.execute("set local role authenticated")
        assert await conn.fetchval("select count(*) from storytime") == 1
        with pytest.raises(Exception, match="permission denied"):
            async with conn.transaction():
                await conn.fetch("select * from storytime_attempt")
    async with conn.transaction():
        await conn.execute("select set_config('request.jwt.claim.sub',$1,true)", str(uuid4()))
        await conn.execute("set local role authenticated")
        assert await conn.fetchval("select count(*) from storytime") == 0


async def test_access_flag_publication_and_cap(conn, fakes, seed, monkeypatch):
    with pytest.raises(HTTPException) as no_story:
        await ask(seed)
    assert no_story.value.status_code == 409
    monkeypatch.setattr(get_settings(), "storytime_enabled", False)
    with pytest.raises(HTTPException) as disabled:
        await ask(seed)
    assert disabled.value.status_code == 404
    assert not (await storytime.availability(User(id=seed.user_id))).available


async def test_unauthorized_people_cannot_create(conn, fakes, seed, material):
    outsider = uuid4()
    with pytest.raises(HTTPException) as denied:
        await ask(seed, outsider)
    assert denied.value.status_code == 403
    await conn.execute("insert into auth.users values($1)", outsider)
    person = await conn.fetchval(
        "insert into person(family_id,display_name) values($1,'Other') returning id", seed.family_id
    )
    await conn.execute(
        "insert into member values($1,$2,$3,'member')", outsider, seed.family_id, person
    )
    with pytest.raises(HTTPException) as relative:
        await ask(seed, outsider)
    assert relative.value.status_code == 403


async def test_cap_counts_remove_and_regenerate(conn, fakes, seed, material, monkeypatch):
    monkeypatch.setattr(get_settings(), "storytime_daily_limit_per_family", 2)
    await ask(seed)
    await storytime.remove(seed.heirloom_id, User(id=seed.user_id))
    await ask(seed)
    await conn.execute("update storytime set status='failed'")
    with pytest.raises(HTTPException) as capped:
        await ask(seed)
    assert capped.value.status_code == 429
    assert await conn.fetchval("select count(*) from storytime_attempt") == 2


async def test_concurrent_create_counts_once(conn, fakes, seed, material):
    results = await asyncio.gather(ask(seed), ask(seed))
    assert sorted(code for _, code in results) == [200, 202]
    assert results[0][0].id == results[1][0].id
    assert await conn.fetchval("select count(*) from storytime_attempt") == 1


async def test_script_and_render_resume_complete_and_notify(
    conn, fakes, seed, material, media_fakes
):
    await ask(seed)
    a = await attempt(conn, seed)
    await storytime_script.run(a)
    assert (await current(a))["status"] == "gathering"
    await storytime_render.run(a)
    row = await current(a)
    assert row["status"] == "ready"
    assert all(
        v["path"].startswith(f"{seed.family_id}/")
        for v in row["assets"].values()
        if isinstance(v, dict) and "path" in v
    )
    assert len(fakes.tts.calls) == 2
    assert (
        await conn.fetchval(
            "select count(*) from notification where type='storytime_ready' and recipient_id=$1",
            seed.narrator_id,
        )
        == 1
    )
    await storytime_render.run(a)
    assert len(fakes.tts.calls) == 2
    before = await storytime.get(seed.heirloom_id, User(id=seed.user_id))
    assert before.video_url and not before.stale
    assert (await storytime.get_public(seed.heirloom_id, "abc")).video_url
    await conn.execute(
        "insert into story(heirloom_id,version,title,blocks) values($1,2,'New story','[]')",
        seed.heirloom_id,
    )
    assert (await storytime.get(seed.heirloom_id, User(id=seed.user_id))).stale
    replacement, code = await ask(seed)
    assert code == 202 and replacement.video_url == before.video_url and replacement.stale
    assert (await storytime.get_public(seed.heirloom_id, "abc")).video_url == before.video_url
    await storytime_render.run(a)
    assert (await current(await attempt(conn, seed)))["status"] == "queued"


async def test_partial_render_resumes_saved_images_and_audio(
    conn, fakes, seed, material, media_fakes, monkeypatch
):
    await ask(seed)
    a = await attempt(conn, seed)
    await storytime_script.run(a)
    original = fakes.tts.speak
    calls = 0

    async def fail_second(text, **kw):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("temporary failure")
        return await original(text, **kw)

    monkeypatch.setattr(fakes.tts, "speak", fail_second)
    with pytest.raises(RuntimeError):
        await storytime_render.run(a)
    row = await current(a)
    assert row["assets"]["audio_0"]["saved"]
    monkeypatch.setattr(fakes.tts, "speak", original)
    await storytime_render.run(a)
    assert (await current(a))["status"] == "ready"
    assert len(fakes.tts.calls) == 2


async def test_stock_failure_falls_back_to_illustration(conn, fakes, seed, material, media_fakes):
    board = material["board"].model_copy(deep=True)
    board.scenes[1].visual = SceneVisual(source="stock", stock_query="old train platform")
    fakes.llm.responses[Storyboard] = board
    await ask(seed)
    a = await attempt(conn, seed)
    await storytime_script.run(a)
    await storytime_render.run(a)
    assert fakes.stock.queries == ["old train platform"]
    assert len(fakes.image.prompts) == 1


async def test_removed_attempt_cannot_save_or_render(conn, fakes, seed, material):
    await ask(seed)
    a = await attempt(conn, seed)
    await storytime.remove(seed.heirloom_id, User(id=seed.user_id))
    await storytime_script.run(a)
    await storytime_render.run(a)
    with pytest.raises(Superseded):
        await update(a, status="ready")
    assert not fakes.tts.calls
    assert await conn.fetchval("select count(*) from storytime") == 0


async def test_public_only_exposes_finished_video(conn, fakes, seed, material):
    await ask(seed)
    for key in ("abc", "wrong"):
        with pytest.raises(HTTPException) as missing:
            await storytime.get_public(seed.heirloom_id, key)
        assert missing.value.status_code == 404


def test_validation_drops_foreign_audio_citations_and_first_person(seed, material):
    board = material["board"]
    s = material["segment"]
    segments = {
        s: {
            "id": s,
            "turn_id": material["turn"],
            "start_ms": 0,
            "end_ms": 1000,
            "text": "I kept the watch.",
            "narrator_id": seed.narrator_id,
        }
    }
    good, problems = validate(board, segments, {}, {seed.photo_id}, seed.narrator_id)
    assert good and not problems
    bad = board.model_copy(deep=True)
    bad.scenes[0].narration = "I remember the watch."
    assert validate(bad, segments, {}, set(), seed.narrator_id)[0] is None
    bad = board.model_copy(deep=True)
    bad.scenes[0].cites = [SegmentCite(kind="segment", segment_id=uuid4())]
    assert validate(bad, segments, {}, set(), seed.narrator_id)[0] is None
    assert validate(board, segments, {}, set(), uuid4())[0] is None


def png():
    def chunk(kind, data):
        return (
            struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 2, 2, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(b"\0" + b"\x80\x60\x40" * 2 + b"\0" + b"\x80\x60\x40" * 2))
        + chunk(b"IEND", b"")
    )


async def test_real_ffmpeg_timeline_and_caption_smoke(tmp_path):
    import shutil

    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        pytest.skip("ffmpeg required")
    image = tmp_path / "picture.png"
    image.write_bytes(png())
    audio = tmp_path / "voice.wav"
    audio.write_bytes(make_wav(1))
    plan = RenderPlan(
        [
            Clip(str(image), None, 2),
            Clip(str(image), str(audio), 2, "She kept the watch.", voice=True),
            Clip(str(image), None, 2),
        ],
        str(tmp_path / "captions.ass"),
        str(storytime_render.MUSIC / "tender.wav"),
        str(tmp_path / "video.mp4"),
        width=320,
        height=180,
    )
    await asyncio.to_thread(
        Path(plan.captions).write_text, captions(plan, "A watch", "Grandma", [])
    )
    args = build_ffmpeg_args(plan)
    assert "sidechaincompress" in args[args.index("-filter_complex") + 1]
    assert "volume=0:enable='between" in args[args.index("-filter_complex") + 1]
    await execute(args)
    assert abs(await duration(Path(plan.output)) - plan.duration) < 0.15


async def test_http_contract_create_status_public_and_remove(conn, fakes, seed, material):
    import httpx

    from app.auth import current_user
    from app.main import app

    app.dependency_overrides[current_user] = lambda: User(id=seed.user_id)
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            path = f"/api/stories/{seed.heirloom_id}/storytime"
            assert (await client.get("/api/storytime/available")).json() == {"available": True}
            created = await client.post(path)
            assert created.status_code == 202 and created.json()["can_manage"]
            assert (await client.post(path)).status_code == 200
            assert (await client.get(path)).json()["status"] == "queued"
            assert (
                await client.get(f"/api/public/stories/{seed.heirloom_id}/storytime?k=wrong")
            ).status_code == 404
            deleted = await client.delete(path)
            assert deleted.status_code == 204 and not deleted.content
    finally:
        app.dependency_overrides.pop(current_user, None)


async def test_request_listener_and_storyteller_notifications_are_deduplicated(
    conn, fakes, seed, material, media_fakes
):
    listener = await conn.fetchval(
        "insert into person(family_id,display_name) values($1,'Listener') returning id",
        seed.family_id,
    )
    request = await conn.fetchval(
        "insert into story_request(heirloom_id,listener_id,storyteller_id) "
        "values($1,$2,$3) returning id",
        seed.heirloom_id,
        listener,
        seed.narrator_id,
    )
    await conn.execute("update story set request_id=$2 where id=$1", material["story"], request)
    await ask(seed)
    a = await attempt(conn, seed)
    await storytime_script.run(a)
    await storytime_render.run(a)
    recipients = await conn.fetch(
        "select recipient_id from notification where type='storytime_ready'"
    )
    assert {r["recipient_id"] for r in recipients} == {listener, seed.narrator_id}
    assert len(recipients) == 2


async def test_standalone_story_uses_actual_interview_narrator(
    conn, fakes, seed, material, media_fakes
):
    narrator = await conn.fetchval(
        "insert into person(family_id,display_name) values($1,'Grandma') returning id",
        seed.family_id,
    )
    await conn.execute("update story set storyteller_id=null where id=$1", material["story"])
    await conn.execute(
        "update interview set narrator_id=$2 where heirloom_id=$1", seed.heirloom_id, narrator
    )
    await ask(seed)
    a = await attempt(conn, seed)
    await storytime_script.run(a)
    await storytime_render.run(a)
    assert (await current(a))["status"] == "ready"
    recipients = await conn.fetch(
        "select recipient_id from notification where type='storytime_ready'"
    )
    assert {r["recipient_id"] for r in recipients} == {narrator, seed.narrator_id}


async def test_remove_retries_storage_cleanup_after_database_row_is_gone(
    conn, fakes, seed, material, media_fakes, monkeypatch
):
    from app import storage

    await ask(seed)
    a = await attempt(conn, seed)
    await storytime_script.run(a)
    await storytime_render.run(a)
    original = storage.remove

    async def unavailable(bucket, paths):
        raise RuntimeError("storage temporarily unavailable")

    monkeypatch.setattr(storage, "remove", unavailable)
    with pytest.raises(RuntimeError):
        await storytime.remove(seed.heirloom_id, User(id=seed.user_id))
    assert await conn.fetchval("select count(*) from storytime") == 0
    monkeypatch.setattr(storage, "remove", original)
    await storytime.remove(seed.heirloom_id, User(id=seed.user_id))
    assert not any("/storytime/" in p for p in fakes.files)
