"""Immersive memories (docs/IMMERSIVE.md §7): asking for a world, building it, walking it."""

import io
from dataclasses import dataclass
from uuid import UUID, uuid4

import httpx
import pytest
from fastapi import HTTPException, Response
from PIL import Image

from app import world_reference
from app.auth import User
from app.config import get_settings
from app.jobs.stages import immersive_world
from app.models import (
    HotspotPlan,
    ReferencePicks,
    ReferenceQuality,
    SceneSpec,
    SpotPosition,
    SpotPositions,
)
from app.providers.base import Blob, ImageResult, RateLimited, WorldAssets, WorldOp
from app.routers import immersive

ASSETS = WorldAssets(
    world_id="wl-world-1",
    spz_urls={"100k": "https://wl.test/100k.spz", "500k": "https://wl.test/500k.spz"},
    pano_url="https://wl.test/pano.png",
    thumbnail_url="https://wl.test/thumb.jpg",
    collider_mesh_url=None,
    caption="a courtyard",
    metric_scale_factor=1.5,
    ground_plane_offset=0.3,
)
DONE = WorldOp(operation_id="op-1", done=True, result=ASSETS)
WAITING = WorldOp(operation_id="op-1", done=False)


@dataclass
class Story:
    memory_id: UUID
    observation_id: UUID
    segment_id: UUID


@pytest.fixture(autouse=True)
def enabled(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "immersive_enabled", True)
    monkeypatch.setattr(s, "immersive_daily_limit_per_family", 5)

    async def no_wait(seconds):
        return None

    monkeypatch.setattr(immersive_world, "_wait", no_wait)


@pytest.fixture
async def story(conn, seed, fakes) -> Story:
    interview_id = await conn.fetchval(
        "insert into interview (heirloom_id, narrator_id, interviewer_user_id) "
        "values ($1, $2, $3) returning id",
        seed.heirloom_id,
        seed.narrator_id,
        seed.user_id,
    )
    audio_id = await conn.fetchval(
        "insert into media (family_id, heirloom_id, kind, storage_path, mime) "
        "values ($1, $2, 'audio', $3, 'audio/wav') returning id",
        seed.family_id,
        seed.heirloom_id,
        f"{seed.family_id}/{seed.heirloom_id}/answer.wav",
    )
    turn_id = await conn.fetchval(
        "insert into turn (interview_id, idx, role, text, audio_media_id) "
        "values ($1, 1, 'answer', 'We sat under the neem tree.', $2) returning id",
        interview_id,
        audio_id,
    )
    segment_id = await conn.fetchval(
        "insert into segment (turn_id, start_ms, end_ms, text) "
        "values ($1, 0, 2400, 'We sat under the neem tree.') returning id",
        turn_id,
    )
    memory_id = await conn.fetchval(
        "insert into fact (heirloom_id, kind, text, source) values ($1, 'memory', $2, $3) "
        "returning id",
        seed.heirloom_id,
        "Nani sat under the neem tree in the courtyard.",
        {"kind": "memory", "segment_ids": [str(segment_id)], "narrator_id": str(seed.narrator_id)},
    )
    observation_id = await conn.fetchval(
        "insert into fact (heirloom_id, kind, text, source) values ($1, 'observation', $2, $3) "
        "returning id",
        seed.heirloom_id,
        "A brass lamp with a dented base.",
        {"kind": "observation", "media_id": str(seed.photo_id), "via": "vision"},
    )
    return Story(memory_id, observation_id, segment_id)


def scene(*fact_ids, mode="text", place_query=None, place_name=None):
    return SceneSpec(
        input_mode=mode,
        scene_prompt="A sunlit courtyard with a neem tree and a brass lamp on a low wall.",
        used_fact_ids=list(fact_ids),
        hotspots=[HotspotPlan(label="The neem tree", fact_ids=list(fact_ids))],
        place_query=place_query,
        place_name=place_name,
    )


def photo(name, via="google_images", width=2000):
    return ImageResult(
        url=f"https://img.test/{name}.jpg",
        page_url=f"https://page.test/{name}",
        title=name,
        width=width if via == "google_images" else None,
        via=via,
    )


def reference_image(name="scene"):
    out = io.BytesIO()
    Image.new("RGB", (1280, 720), "#b0a080").save(out, "PNG")
    return out.getvalue() + name.encode()


@pytest.fixture
def web(monkeypatch):
    """What each web photo URL downloads as. A URL left out fails to download."""
    files: dict[str, bytes] = {}

    async def download(url):
        return files.get(url)

    monkeypatch.setattr(world_reference, "_download", download)
    return files


def courtyard_photos(fakes, web, *names, via="google_images"):
    found = [photo(n, via) for n in names]
    for p in found:
        web[p.url] = reference_image(p.title)
    if via == "google_maps":
        fakes.search.place_found = found
    else:
        fakes.search.images_found = found
    return found


def ready_world(fakes, story):
    fakes.image.data = reference_image()
    fakes.llm.responses[ReferenceQuality] = ReferenceQuality(
        usable=True, reason="A clear wide setting"
    )
    fakes.llm.responses[SceneSpec] = scene(story.memory_id, story.observation_id)
    fakes.llm.responses[SpotPositions] = SpotPositions(
        spots=[SpotPosition(label="The neem tree", u=0.25, v=0.6)]
    )
    fakes.world.polls = [WAITING, DONE]
    fakes.world.files = {
        "https://wl.test/100k.spz": b"spz-small",
        "https://wl.test/500k.spz": b"spz-big",
        "https://wl.test/pano.png": b"\x89PNG\r\n\x1a\npano",
        "https://wl.test/thumb.jpg": b"\xff\xd8thumb",
    }


async def ask(seed, user_id=None):
    response = Response()
    world = await immersive.create_world(
        seed.heirloom_id, seed.photo_id, User(id=user_id or seed.user_id), response
    )
    return world, response.status_code


async def status_of(conn, world_id):
    return await conn.fetchrow("select * from immersive_world where id = $1", world_id)


# Asking -----------------------------------------------------------------------------------------


async def test_asking_queues_one_world_per_photo(conn, fakes, seed, story):
    world, code = await ask(seed)
    again, again_code = await ask(seed)

    assert (code, world.status) == (202, "queued")
    assert (again.id, again_code) == (world.id, 200), "asking twice never pays twice"
    job = await conn.fetchrow("select kind, status from job where subject_id = $1", world.id)
    assert (job["kind"], job["status"]) == ("immersive_world", "queued")


async def test_asking_needs_the_family_and_a_finished_interview(conn, fakes, seed):
    with pytest.raises(HTTPException) as no_story:
        await ask(seed)
    assert no_story.value.status_code == 409

    outsider = uuid4()
    await conn.execute("insert into auth.users values ($1)", outsider)
    with pytest.raises(HTTPException) as stranger:
        await ask(seed, outsider)
    assert stranger.value.status_code == 403


async def test_asking_stops_at_the_daily_family_limit(conn, fakes, seed, story, monkeypatch):
    monkeypatch.setattr(get_settings(), "immersive_daily_limit_per_family", 0)
    with pytest.raises(HTTPException) as over:
        await ask(seed)
    assert over.value.status_code == 429


async def test_asking_after_a_failure_queues_it_again(conn, fakes, seed, story):
    world, _ = await ask(seed)
    await conn.execute(
        "update immersive_world set status = 'failed', error = 'boom' where id = $1", world.id
    )
    await conn.execute("update job set status = 'failed' where subject_id = $1", world.id)

    again, code = await ask(seed)

    row = await status_of(conn, world.id)
    assert (again.id, code, row["status"], row["error"]) == (world.id, 202, "queued", None)
    assert await conn.fetchval("select status from job where subject_id = $1", world.id) == "queued"


async def test_a_world_whose_job_died_before_it_ran_reads_as_failed(conn, fakes, seed, story):
    """A worker that couldn't run the stage failed the job without touching the world row."""
    world, _ = await ask(seed)
    await conn.execute(
        "update job set status = 'failed', error = $2 where subject_id = $1",
        world.id,
        "KeyError('immersive_world')",
    )

    [photo] = await immersive.list_worlds(seed.heirloom_id, User(id=seed.user_id))
    walk = await immersive.get_world(world.id, User(id=seed.user_id))
    assert (photo.world.status, walk.status, walk.error) == (
        "failed",
        "failed",
        "KeyError('immersive_world')",
    )

    again, code = await ask(seed)
    assert (again.id, code) == (world.id, 202), "Try again works on it"
    [photo] = await immersive.list_worlds(seed.heirloom_id, User(id=seed.user_id))
    assert photo.world.status == "queued"


async def test_a_world_pins_the_story_it_was_imagined_from(conn, fakes, seed, story):
    v1 = await conn.fetchval(
        "insert into story (heirloom_id, version, title, blocks) values ($1, 1, 'v1', '[]') "
        "returning id",
        seed.heirloom_id,
    )
    v2 = await conn.fetchval(
        "insert into story (heirloom_id, version, title, blocks) values ($1, 2, 'v2', '[]') "
        "returning id",
        seed.heirloom_id,
    )
    world, _ = await ask(seed)

    row = await status_of(conn, world.id)
    assert row["story_id"] == v2, "the latest story, not the first"
    assert row["heirloom_id"] == seed.heirloom_id and row["source_media_id"] == seed.photo_id

    # A retry after a failure re-pins to the newest story.
    v3 = await conn.fetchval(
        "insert into story (heirloom_id, version, title, blocks) values ($1, 3, 'v3', '[]') "
        "returning id",
        seed.heirloom_id,
    )
    assert v1 != v3
    await conn.execute(
        "update immersive_world set status = 'failed', error = 'boom' where id = $1", world.id
    )
    await ask(seed)
    assert await conn.fetchval("select story_id from immersive_world where id = $1", world.id) == v3


async def test_a_world_without_any_story_still_builds(conn, fakes, seed, story):
    world, _ = await ask(seed)
    assert await conn.fetchval("select story_id from immersive_world where id = $1", world.id) is (
        None
    )


async def test_the_story_page_sees_each_photo_and_its_world(conn, fakes, seed, story):
    [before] = await immersive.list_worlds(seed.heirloom_id, User(id=seed.user_id))
    assert (before.media_id, before.is_cover, before.world) == (seed.photo_id, True, None)

    world, _ = await ask(seed)

    [after] = await immersive.list_worlds(seed.heirloom_id, User(id=seed.user_id))
    assert (after.world.id, after.world.status) == (world.id, "queued")
    assert await immersive.list_public_worlds(seed.heirloom_id, "abc") == [], "not ready yet"


async def test_every_route_is_hidden_while_the_flag_is_off(conn, fakes, seed, story, monkeypatch):
    monkeypatch.setattr(get_settings(), "immersive_enabled", False)
    with pytest.raises(HTTPException) as hidden:
        await ask(seed)
    assert hidden.value.status_code == 404
    with pytest.raises(HTTPException):
        await immersive.list_worlds(seed.heirloom_id, User(id=seed.user_id))


# Building ---------------------------------------------------------------------------------------


async def test_a_world_is_built_saved_and_its_spots_placed(conn, fakes, seed, story):
    ready_world(fakes, story)
    world, _ = await ask(seed)

    await immersive_world.run(world.id)

    row = await status_of(conn, world.id)
    assert row["status"] == "ready" and row["provider_world_id"] == "wl-world-1"
    assert set(row["assets"]) == {"spz_100k", "spz_500k", "pano", "thumbnail"}
    assert all(p.startswith(f"{seed.family_id}/") for p in row["assets"].values())
    assert fakes.files[row["assets"]["spz_500k"]] == b"spz-big"
    assert row["semantics"] == {"metric_scale_factor": 1.5, "ground_plane_offset": 0.3}
    [spot] = row["hotspots"]
    assert (spot["u"], spot["v"]) == (0.25, 0.6)
    assert spot["segment_ids"] == [str(story.segment_id)], "the spot plays her own words"
    assert fakes.world.started[0]["image"].data == fakes.image.data
    assert row["reference"]["via"] == "generated"
    assert row["input_audit"]["request_type"] == "image"

    walk = await immersive.get_world(world.id, User(id=seed.user_id))
    assert walk.label == "Imagined from Nani's words, not a photograph"
    assert [s.text for s in walk.spots[0].segments] == ["We sat under the neem tree."]
    assert walk.assets["spz_100k"].startswith("https://storage.test/generated/")


async def test_a_wide_photo_of_a_place_is_sent_as_the_image(conn, fakes, seed, story):
    ready_world(fakes, story)
    fakes.llm.responses[SceneSpec] = scene(story.memory_id, mode="image")
    path = await conn.fetchval("select storage_path from media where id=$1", seed.photo_id)
    fakes.files[path] = reference_image("family")
    world, _ = await ask(seed)

    await immersive_world.run(world.id)

    assert fakes.world.started[0]["image"].data == reference_image("family")


async def test_a_close_up_world_is_built_on_a_real_photo_of_the_place(
    conn, fakes, seed, story, web
):
    ready_world(fakes, story)
    fakes.llm.responses[SceneSpec] = scene(story.memory_id, place_query="village courtyard")
    courtyard_photos(fakes, web, "crowded", "courtyard")
    fakes.llm.responses[ReferencePicks] = ReferencePicks(ranked=[1])
    world, _ = await ask(seed)

    await immersive_world.run(world.id)

    row = await status_of(conn, world.id)
    assert (row["status"], row["input_mode"]) == ("ready", "reference")
    assert fakes.search.queries == ["village courtyard"] and fakes.search.places == []
    assert fakes.world.started[0]["image"].data == reference_image("courtyard")
    assert row["reference"]["path"].startswith(f"{seed.family_id}/")
    assert fakes.files[row["reference"]["path"]] == reference_image("courtyard")
    walk = await immersive.get_world(world.id, User(id=seed.user_id))
    assert walk.reference and walk.reference.page_url == "https://page.test/courtyard"


async def test_a_named_place_offers_its_own_photos_first(conn, fakes, seed, story, web):
    ready_world(fakes, story)
    fakes.llm.responses[SceneSpec] = scene(
        story.memory_id, place_query="village courtyard", place_name="Haveli Ram Nagar"
    )
    courtyard_photos(fakes, web, "any-courtyard")
    courtyard_photos(fakes, web, "the-haveli", via="google_maps")
    fakes.llm.responses[ReferencePicks] = ReferencePicks(ranked=[0])
    world, _ = await ask(seed)

    await immersive_world.run(world.id)

    row = await status_of(conn, world.id)
    assert fakes.search.places == ["Haveli Ram Nagar"]
    assert row["reference"]["via"] == "google_maps"
    assert fakes.world.started[0]["image"].data == reference_image("the-haveli")


async def test_a_photo_that_will_not_download_is_never_offered(conn, fakes, seed, story, web):
    ready_world(fakes, story)
    fakes.llm.responses[SceneSpec] = scene(story.memory_id, place_query="village courtyard")
    gone, kept = courtyard_photos(fakes, web, "gone", "kept")
    web[gone.url] = b"<html>a page, not a photo</html>"
    fakes.llm.responses[ReferencePicks] = ReferencePicks(ranked=[0])
    world, _ = await ask(seed)

    await immersive_world.run(world.id)

    assert (await status_of(conn, world.id))["reference"]["url"] == kept.url


async def test_without_a_usable_photo_a_scene_image_is_generated_first(
    conn, fakes, seed, story, web
):
    ready_world(fakes, story)
    fakes.llm.responses[SceneSpec] = scene(story.memory_id, place_query="village courtyard")
    courtyard_photos(fakes, web, "a-logo")
    fakes.llm.responses[ReferencePicks] = ReferencePicks(ranked=[])
    world, _ = await ask(seed)

    await immersive_world.run(world.id)

    row = await status_of(conn, world.id)
    assert (row["status"], row["input_mode"], row["reference"]["via"]) == (
        "ready",
        "reference",
        "generated",
    )
    assert fakes.world.started[0]["image"].data == fakes.image.data
    assert row["input_audit"]["web_reference"] == "vision_rejected_candidates"
    walk = await immersive.get_world(world.id, User(id=seed.user_id))
    assert walk.reference.kind == "generated" and walk.reference.page_url is None


async def test_a_failed_photo_search_never_fails_the_world(
    conn, fakes, seed, story, web, monkeypatch
):
    ready_world(fakes, story)
    fakes.llm.responses[SceneSpec] = scene(story.memory_id, place_query="village courtyard")

    async def down(q):
        raise RuntimeError("SerpApi is down")

    monkeypatch.setattr(fakes.search, "images", down)
    world, _ = await ask(seed)

    await immersive_world.run(world.id)

    row = await status_of(conn, world.id)
    assert (row["status"], row["input_mode"]) == ("ready", "reference")
    assert row["input_audit"]["searches"][0]["status"] == "failed"
    assert row["reference"]["via"] == "generated"


async def test_a_wide_family_photo_never_searches_the_web(conn, fakes, seed, story, web):
    ready_world(fakes, story)
    fakes.llm.responses[SceneSpec] = scene(
        story.memory_id, mode="image", place_query="village courtyard"
    )
    path = await conn.fetchval("select storage_path from media where id=$1", seed.photo_id)
    fakes.files[path] = reference_image("family")
    world, _ = await ask(seed)

    await immersive_world.run(world.id)

    assert fakes.search.queries == []
    assert (await status_of(conn, world.id))["input_mode"] == "image"


async def test_a_missing_search_query_still_searches_before_generating(conn, fakes, seed, story):
    ready_world(fakes, story)
    world, _ = await ask(seed)
    await immersive_world.run(world.id)
    row = await status_of(conn, world.id)
    assert fakes.search.queries == [row["scene_prompt"]]
    assert row["input_audit"]["request_type"] == "image"


async def test_cached_text_only_plans_are_repaired_before_start(conn, fakes, seed, story):
    ready_world(fakes, story)
    world, _ = await ask(seed)
    await conn.execute(
        "update immersive_world set scene_prompt='A hackathon hall with rows of tables', "
        "input_mode='text', hotspots='[]' where id=$1",
        world.id,
    )
    await immersive_world.run(world.id)
    row = await status_of(conn, world.id)
    assert row["reference"]["via"] == "generated"
    assert fakes.world.started[0]["image"] is not None


@pytest.mark.parametrize("invalid_pixels", [True, False])
async def test_unusable_generated_references_never_start_world_labs(
    conn, fakes, seed, story, invalid_pixels
):
    ready_world(fakes, story)
    if invalid_pixels:
        fakes.image.data = b"not an image"
    else:
        fakes.llm.responses[ReferenceQuality] = ReferenceQuality(
            usable=False, reason="An object close-up rather than a room"
        )
    world, _ = await ask(seed)
    with pytest.raises(ValueError, match="No world generation was started"):
        await immersive_world.run(world.id)
    row = await status_of(conn, world.id)
    assert row["status"] == "failed"
    assert len(row["input_audit"]["generated_attempts"]) == 2
    assert not fakes.world.started
    assert row["provider_operation_id"] is None


async def test_a_maps_reference_survives_an_images_search_failure(
    conn, fakes, seed, story, web, monkeypatch
):
    ready_world(fakes, story)
    fakes.llm.responses[SceneSpec] = scene(
        story.memory_id, place_query="courtyard interior", place_name="A named courtyard"
    )
    courtyard_photos(fakes, web, "courtyard", via="google_maps")
    fakes.llm.responses[ReferencePicks] = ReferencePicks(ranked=[0])

    async def down(q):
        raise RuntimeError("Search temporarily unavailable")

    monkeypatch.setattr(fakes.search, "images", down)
    world, _ = await ask(seed)
    await immersive_world.run(world.id)
    row = await status_of(conn, world.id)
    assert row["reference"]["via"] == "google_maps"
    assert {s["engine"]: s["status"] for s in row["input_audit"]["searches"]} == {
        "google_images": "failed",
        "google_maps": "ok",
    }


async def test_a_valid_saved_reference_is_reused_on_retry(conn, fakes, seed, story):
    ready_world(fakes, story)
    world, _ = await ask(seed)
    await immersive_world.run(world.id)
    searches = len(fakes.search.queries)
    await conn.execute(
        "update immersive_world set status='queued', assets=null, provider_operation_id=null "
        "where id=$1",
        world.id,
    )
    fakes.world.polls = [DONE]
    await immersive_world.run(world.id)
    assert len(fakes.search.queries) == searches
    assert (await status_of(conn, world.id))["status"] == "ready"


@pytest.mark.parametrize("size", [(100, 100), (720, 1280)])
def test_small_and_portrait_images_are_rejected(size):
    out = io.BytesIO()
    Image.new("RGB", size).save(out, "PNG")
    with pytest.raises(ValueError, match="landscape"):
        world_reference.image_details(Blob(data=out.getvalue(), mime="image/png"))


async def test_world_labs_refuses_text_before_any_provider_request(monkeypatch):
    from app.providers.worldlabs import WorldLabsWorldGen

    async def forbidden(*args, **kwargs):
        pytest.fail("text-only input must be rejected before upload or generation")

    monkeypatch.setattr(WorldLabsWorldGen, "_call", forbidden)
    with pytest.raises(ValueError, match="scene reference image is required"):
        await WorldLabsWorldGen(get_settings()).start(
            prompt="A hall", image=None, display_name="memory"
        )


async def test_world_labs_uploads_the_image_and_marks_it_as_non_panorama(monkeypatch):
    from app.providers.worldlabs import WorldLabsWorldGen

    calls = []
    image = Blob(data=reference_image(), mime="image/png")

    async def upload(self, supplied):
        assert supplied == image
        return "media-scene"

    async def call(self, method, path, body=None):
        calls.append(body)
        assert method == "POST" and path == "/worlds:generate"
        return {"operation_id": "new-op"}

    monkeypatch.setattr(WorldLabsWorldGen, "_upload", upload)
    monkeypatch.setattr(WorldLabsWorldGen, "_call", call)
    assert (
        await WorldLabsWorldGen(get_settings()).start(
            prompt="A hall", image=image, display_name="memory"
        )
        == "new-op"
    )
    assert calls[0]["model"] == get_settings().worldlabs_model
    assert calls[0]["world_prompt"] == {
        "type": "image",
        "image_prompt": {"source": "media_asset", "media_asset_id": "media-scene"},
        "text_prompt": "A hall",
        "is_pano": False,
    }


async def test_serpapi_http_errors_never_include_the_api_key(monkeypatch):
    from app.config import Settings
    from app.providers.serpapi import SerpApi

    async def get(self, url, **kwargs):
        return httpx.Response(403, request=httpx.Request("GET", url, params=kwargs["params"]))

    monkeypatch.setattr(httpx.AsyncClient, "get", get)
    with pytest.raises(RuntimeError) as failure:
        await SerpApi(Settings(serpapi_key="private-key"), cache=False).images("hall interior")
    assert "403" in str(failure.value)
    assert "private-key" not in str(failure.value)


@pytest.mark.parametrize("url", ["http://example.com/photo.jpg", "https://127.0.0.1/photo.jpg"])
async def test_private_or_insecure_image_hosts_are_not_downloaded(url):
    assert not await world_reference._public_image_url(url)


async def test_image_provider_outages_fail_before_world_labs(conn, fakes, seed, story, monkeypatch):
    ready_world(fakes, story)

    async def unavailable(prompt):
        raise RuntimeError("Image provider unavailable")

    monkeypatch.setattr(fakes.image, "generate", unavailable)
    world, _ = await ask(seed)
    with pytest.raises(ValueError, match="No world generation was started"):
        await immersive_world.run(world.id)
    row = await status_of(conn, world.id)
    assert row["status"] == "failed"
    assert len(row["input_audit"]["generated_attempts"]) == 2
    assert all(a["error"] == "RuntimeError" for a in row["input_audit"]["generated_attempts"])
    assert not fakes.world.started


def test_the_shortlist_puts_the_named_place_first_and_drops_small_photos():
    big, small, maps = photo("big"), photo("small", width=640), photo("inside", "google_maps")
    assert world_reference.shortlist([maps], [big, small, big]) == [maps, big]


async def test_maps_photos_come_from_inside_the_place(monkeypatch):
    from app.providers.serpapi import SerpApi

    asked = []

    async def search(self, params):
        asked.append(params)
        if params["engine"] == "google_maps":
            return {"place_results": {"title": "Haveli", "address": "Ram Nagar", "data_id": "d1"}}
        if "category_id" not in params:
            return {"categories": [{"title": "Inside", "id": "in"}], "photos": []}
        return {
            "photos": [
                {"image": "https://lh.test/a=w4032", "thumbnail": "https://lh.test/a=w203"},
                {"image": "https://lh.test/v", "video": "https://lh.test/v"},
            ]
        }

    monkeypatch.setattr(SerpApi, "_search", search)
    [p] = await SerpApi(get_settings(), cache=False).place_photos("Haveli Ram Nagar")
    assert asked[-1] == {"engine": "google_maps_photos", "data_id": "d1", "category_id": "in"}
    assert (p.url, p.via) == ("https://lh.test/a=w4032", "google_maps")
    assert p.page_url == "https://www.google.com/maps/search/?api=1&query=Haveli+Ram+Nagar"


async def test_a_restarted_job_polls_the_same_world_instead_of_starting_another(
    conn, fakes, seed, story
):
    ready_world(fakes, story)
    world, _ = await ask(seed)
    await conn.execute(
        "update immersive_world set status = 'generating', scene_prompt = 'a courtyard', "
        "input_mode = 'text', provider_operation_id = 'op-earlier' where id = $1",
        world.id,
    )

    await immersive_world.run(world.id)

    assert fakes.world.started == []
    assert fakes.world.polled[0] == "op-earlier"
    assert (await status_of(conn, world.id))["status"] == "ready"


async def test_facts_from_another_story_are_dropped(conn, fakes, seed, story):
    ready_world(fakes, story)
    stranger = uuid4()
    fakes.llm.responses[SceneSpec] = scene(story.memory_id, stranger)
    world, _ = await ask(seed)

    await immersive_world.run(world.id)

    row = await status_of(conn, world.id)
    assert row["used_fact_ids"] == [story.memory_id]
    assert row["hotspots"][0]["fact_ids"] == [str(story.memory_id)]


async def test_a_scene_with_nothing_from_this_story_fails_cleanly(conn, fakes, seed, story):
    ready_world(fakes, story)
    fakes.llm.responses[SceneSpec] = scene(uuid4())
    world, _ = await ask(seed)

    with pytest.raises(ValueError):
        await immersive_world.run(world.id)

    row = await status_of(conn, world.id)
    assert (row["status"], row["error"]) == ("failed", "not enough story details yet")
    assert fakes.world.started == [], "nothing was paid for"
    await immersive_world.run(world.id)  # the job's retry must not start one either
    assert fakes.world.started == []


async def test_spots_that_cannot_be_placed_still_make_a_ready_world(conn, fakes, seed, story):
    ready_world(fakes, story)
    del fakes.llm.responses[SpotPositions]  # the placing call raises
    world, _ = await ask(seed)

    await immersive_world.run(world.id)

    row = await status_of(conn, world.id)
    assert row["status"] == "ready"
    assert (row["hotspots"][0]["u"], row["hotspots"][0]["v"]) == (None, None)


async def test_a_busy_world_labs_is_waited_out_not_failed(conn, fakes, seed, story):
    ready_world(fakes, story)
    fakes.world.start_errors = [RateLimited(20), RateLimited(20)]
    world, _ = await ask(seed)

    await immersive_world.run(world.id)

    assert len(fakes.world.started) == 3
    assert (await status_of(conn, world.id))["status"] == "ready"


async def test_a_world_labs_error_fails_the_world_and_forgets_the_operation(
    conn, fakes, seed, story
):
    ready_world(fakes, story)
    fakes.world.polls = [WorldOp(operation_id="op-1", done=True, error="generation failed")]
    world, _ = await ask(seed)

    with pytest.raises(RuntimeError):
        await immersive_world.run(world.id)

    row = await status_of(conn, world.id)
    assert (row["status"], row["error"]) == ("failed", "generation failed")
    assert row["provider_operation_id"] is None, "a retry starts a fresh world"


# Walking it from the public link ---------------------------------------------------------------


async def test_the_public_link_shows_only_ready_worlds_with_the_right_code(
    conn, fakes, seed, story
):
    ready_world(fakes, story)
    world, _ = await ask(seed)

    with pytest.raises(HTTPException) as not_yet:
        await immersive.get_public_world(world.id, "abc")
    assert not_yet.value.status_code == 404

    await immersive_world.run(world.id)
    assert (await immersive.get_public_world(world.id, "abc")).status == "ready"
    [shown] = await immersive.list_public_worlds(seed.heirloom_id, "abc")
    assert shown.world.thumbnail_url.startswith("https://storage.test/generated/")
    assert await immersive.list_public_worlds(seed.heirloom_id, "nope") == []
    with pytest.raises(HTTPException) as wrong:
        await immersive.get_public_world(world.id, "nope")
    assert wrong.value.status_code == 404


def test_a_draft_world_from_world_labs_parses():
    """What marble-1.0-draft really returned on 2026-10-25: `world_id`, no pano, no semantics."""
    from app.providers.worldlabs import _assets

    a = _assets(
        {
            "world_id": "332becd9",
            "assets": {
                "mesh": {"collider_mesh_url": "https://cdn.test/c.glb", "hq_mesh_url": None},
                "imagery": {"pano_url": None},
                "splats": {
                    "spz_urls": {"100k": "https://cdn.test/100k.spz"},
                    "semantics_metadata": None,
                },
                "thumbnail_url": "https://cdn.test/thumbnail.webp",
                "caption": "a kitchen",
            },
        }
    )
    assert a.world_id == "332becd9"
    assert a.pano_url is None and a.metric_scale_factor is None
    assert a.spz_urls == {"100k": "https://cdn.test/100k.spz"}


async def test_a_finished_operation_reads_the_world_record(monkeypatch):
    from app.providers.worldlabs import WorldLabsWorldGen

    calls = []

    async def call(self, method, path, body=None):
        calls.append(path)
        if path.startswith("/operations/"):
            world = {"world_id": "w1", "assets": {"imagery": {"pano_url": None}}}
            return {"done": True, "error": None, "response": world}
        return {"world_id": "w1", "assets": {"imagery": {"pano_url": "https://cdn.test/pano.png"}}}

    monkeypatch.setattr(WorldLabsWorldGen, "_call", call)
    op = await WorldLabsWorldGen(get_settings()).poll("op-1")
    assert calls == ["/operations/op-1", "/worlds/w1"]
    assert op.result and op.result.pano_url == "https://cdn.test/pano.png"
