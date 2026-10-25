"""Exercise protected producers unchanged against supporting schema and privacy rules."""

from uuid import uuid4

import asyncpg
import pytest
from fastapi import HTTPException

from app import storage
from app.auth import User
from app.config import get_settings
from app.jobs.stages import storytime_render, storytime_script
from app.routers import immersive, memories, notifications
from tests import test_storytime as protected
from tests.test_memories import add_member, add_other_family, upload, visible

# Reuse main's real stage fixtures/fake media execution without changing its tests or pipeline.
settings = protected.settings
material = protected.material
media_fakes = protected.media_fakes


async def test_request_linked_storytime_can_finish_and_regenerate_twice(
    conn, seed, fakes, material, media_fakes
):
    listener_user, listener = await add_member(conn, seed.family_id, "Listener")
    request_id = await conn.fetchval(
        "insert into story_request(heirloom_id,listener_id,storyteller_id,status) "
        "values($1,$2,$3,'completed') returning id",
        seed.heirloom_id,
        listener,
        seed.narrator_id,
    )
    await conn.execute("update story set request_id=$2 where id=$1", material["story"], request_id)
    attempts = []
    for _ in range(2):
        _, code = await protected.ask(seed)
        assert code == 202
        attempt = await protected.attempt(conn, seed)
        attempts.append(attempt)
        await storytime_script.run(attempt)
        await storytime_render.run(attempt)
        row = await protected.current(attempt)
        assert row["status"] == "ready" and row["video_media_id"] is not None
    assert len(set(attempts)) == 2
    assert await conn.fetchval("select count(*) from storytime_attempt") == 2
    assert await conn.fetchval("select count(*) from media where kind='generated_video'") == 2
    assert (
        await conn.fetchval("select count(*) from notification where type='storytime_ready'") == 4
    )
    inbox = await notifications.list_notifications(User(listener_user))
    assert len(inbox) == 2
    assert {n.request_id for n in inbox} == {request_id}
    assert {n.heirloom_id for n in inbox} == {seed.heirloom_id}
    assert (await notifications.unread_count(User(listener_user))).count == 2


async def test_storage_policy_preserves_world_and_storytime_assets_without_opening_drafts(
    conn, seed, fakes, material, monkeypatch
):
    monkeypatch.setattr(get_settings(), "immersive_enabled", True)
    relative, _ = await add_member(conn, seed.family_id, "Relative")
    _, outsider, _ = await add_other_family(conn)
    world_id = uuid4()
    world_path = storage.world_path(seed.family_id, seed.heirloom_id, world_id, "pano", "png")
    await conn.execute(
        "insert into immersive_world "
        "(id,family_id,heirloom_id,source_media_id,requested_by,status,assets,story_id) "
        "values($1,$2,$3,$4,$5,'ready',$6,$7)",
        world_id,
        seed.family_id,
        seed.heirloom_id,
        seed.photo_id,
        seed.user_id,
        {"pano": world_path},
        material["story"],
    )
    await protected.ask(seed)
    attempt = await protected.attempt(conn, seed)
    scratch_path = storage.storytime_path(
        seed.family_id, seed.heirloom_id, attempt, "visual_0", "png"
    )
    await protected.update(attempt, asset={"visual_0": {"path": scratch_path, "saved": True}})
    draft = await memories.create_family_memory(
        seed.family_id, memories.CreateFamilyMemory(title="Private draft"), User(seed.user_id)
    )
    _, draft_path, _ = await upload(
        conn, fakes, draft.id, seed.user_id, "photo", "image/jpeg", b"private"
    )
    pending = await memories.create_memory_upload(
        draft.id,
        memories.CreateUpload(kind="photo", mime="image/png", byte_size=7),
        User(seed.user_id),
    )
    pending_path = await conn.fetchval(
        "select storage_path from media where id=$1", pending.media_id
    )
    orphan = f"{seed.family_id}/unreferenced.png"
    await conn.executemany(
        "insert into storage.objects(bucket_id,name) values($1,$2)",
        [
            ("generated", world_path),
            ("generated", scratch_path),
            ("photos", world_path),
            ("photos", draft_path),
            ("photos", pending_path),
            ("generated", orphan),
        ],
    )
    objects = "select count(*) from storage.objects where name=any($1::text[])"
    all_paths = [world_path, scratch_path, draft_path, pending_path, orphan]
    assert await visible(conn, relative, objects, all_paths) == 2
    assert await visible(conn, outsider, objects, all_paths) == 0
    world = await immersive.get_world(world_id, User(relative))
    assert world.assets["pano"].endswith(world_path)
    with pytest.raises(HTTPException) as hidden:
        await immersive.get_world(world_id, User(outsider))
    assert hidden.value.status_code == 403
    with pytest.raises(HTTPException):
        await memories.get_family_memory(draft.id, User(relative))
    await conn.execute("delete from storytime where generation_id=$1", attempt)
    assert await visible(conn, relative, objects, [scratch_path]) == 0
    await conn.execute(
        "delete from member where user_id=$1 and family_id=$2", relative, seed.family_id
    )
    assert await visible(conn, relative, objects, all_paths) == 0
    with pytest.raises(HTTPException):
        await immersive.get_world(world_id, User(relative))


@pytest.mark.parametrize("reference", ["world", "video", "poster"])
async def test_memory_deletion_checks_explicit_protected_references_before_storage(
    conn, seed, fakes, material, reference
):
    owner = User(seed.user_id)
    draft = await memories.create_family_memory(
        seed.family_id, memories.CreateFamilyMemory(title="Keep"), owner
    )
    photo_id, path, _ = await upload(
        conn, fakes, draft.id, seed.user_id, "photo", "image/jpeg", b"keep"
    )
    if reference == "world":
        await conn.execute(
            "insert into immersive_world "
            "(family_id,heirloom_id,source_media_id,requested_by) values($1,$2,$3,$4)",
            seed.family_id,
            seed.heirloom_id,
            photo_id,
            seed.user_id,
        )
    else:
        await protected.ask(seed)
        column = {"video": "video_media_id", "poster": "poster_media_id"}[reference]
        await conn.execute(f"update storytime set {column}=$1", photo_id)
    with pytest.raises(HTTPException) as referenced:
        await memories.delete_memory_media(draft.id, photo_id, owner)
    assert referenced.value.status_code == 409
    with pytest.raises(HTTPException):
        await memories.delete_family_memory(draft.id, owner)
    assert path in fakes.files
    assert await conn.fetchval("select 1 from media where id=$1", photo_id) == 1


async def test_storage_success_then_database_failure_is_safe_to_retry(conn, seed, fakes):
    owner = User(seed.user_id)
    draft = await memories.create_family_memory(
        seed.family_id, memories.CreateFamilyMemory(title="Retry deletion"), owner
    )
    photo_id, path, _ = await upload(
        conn, fakes, draft.id, seed.user_id, "photo", "image/jpeg", b"retry"
    )
    await conn.execute(
        "create function pg_temp.fail_media_cleanup() returns trigger language plpgsql as $$ "
        "begin raise exception 'synthetic database cleanup failure'; end $$; "
        "create trigger test_media_cleanup_failure before delete on media "
        "for each row execute function pg_temp.fail_media_cleanup()"
    )
    try:
        with pytest.raises(asyncpg.RaiseError, match="synthetic database cleanup failure"):
            await memories.delete_family_memory(draft.id, owner)
        assert path not in fakes.files
        assert await conn.fetchval("select 1 from media where id=$1", photo_id) == 1
        assert (
            await conn.fetchval("select status from family_memory where id=$1", draft.id) == "draft"
        )
    finally:
        await conn.execute("drop trigger test_media_cleanup_failure on media")
    await memories.delete_family_memory(draft.id, owner)
    assert path not in fakes.files
    assert await conn.fetchval("select 1 from media where id=$1", photo_id) is None
    assert await conn.fetchval("select 1 from family_memory where id=$1", draft.id) is None
