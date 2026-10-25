"""Main-feature notification contracts remain private and usable after supporting integration."""

from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.auth import User
from app.routers import notifications
from tests.test_invites import add_user
from tests.test_memories import add_member, add_other_family, visible


async def completed_storytime(conn, seed):
    _, teller = await add_member(conn, seed.family_id, "Storyteller")
    request_id = await conn.fetchval(
        "insert into story_request (heirloom_id, listener_id, storyteller_id, status) "
        "values ($1, $2, $3, 'completed') returning id",
        seed.heirloom_id,
        seed.narrator_id,
        teller,
    )
    story_id = await conn.fetchval(
        "insert into story (heirloom_id, version, title, blocks, request_id) "
        "values ($1, 1, 'The family watch', '[]', $2) returning id",
        seed.heirloom_id,
        request_id,
    )
    video_id = await conn.fetchval(
        "insert into media (family_id, heirloom_id, kind, storage_path, mime) "
        "values ($1, $2, 'generated_video', $3, 'video/mp4') returning id",
        seed.family_id,
        seed.heirloom_id,
        f"{seed.family_id}/{seed.heirloom_id}/storytime/{uuid4()}/video.mp4",
    )
    storytime_id = await conn.fetchval(
        "insert into storytime "
        "(family_id, heirloom_id, story_id, requested_by, generation_id, status, "
        "video_media_id, video_story_id) "
        "values ($1, $2, $3, $4, $5, 'ready', $6, $3) returning id",
        seed.family_id,
        seed.heirloom_id,
        story_id,
        seed.user_id,
        uuid4(),
        video_id,
    )
    return request_id, story_id, storytime_id, video_id


async def add_storytime_notification(conn, person_id, story_id, request_id=None):
    return await conn.fetchval(
        "insert into notification (recipient_id, type, story_id, request_id) "
        "values ($1, 'storytime_ready', $2, $3) returning id",
        person_id,
        story_id,
        request_id,
    )


async def test_repeated_storytime_completions_preserve_main_shape_and_read_state(conn, seed):
    request_id, story_id, storytime_id, _ = await completed_storytime(conn, seed)
    await conn.execute(
        "update heirloom set title = 'Grandmother’s watch' where id = $1", seed.heirloom_id
    )
    first = await add_storytime_notification(conn, seed.narrator_id, story_id, request_id)
    second = await add_storytime_notification(conn, seed.narrator_id, story_id, request_id)
    await conn.execute(
        "update notification set created_at = now() + interval '1 second' where id = $1",
        second,
    )

    owner = User(seed.user_id)
    page = await notifications.list_notifications(owner, limit=1)
    assert [item.id for item in page] == [second]
    older = await notifications.list_notifications(owner, limit=1, offset=1)
    assert [item.id for item in older] == [first]
    item = page[0]
    assert item.recipient_id == seed.narrator_id
    assert item.heirloom_id == seed.heirloom_id
    assert item.request_id == request_id and item.story_id == story_id
    assert (item.type, item.destination_type, item.destination_id) == (
        "storytime_ready",
        "story",
        seed.heirloom_id,
    )
    assert item.related_image_media_id == seed.photo_id
    assert "Grandmother’s watch" in item.message
    assert (await notifications.unread_count(owner)).count == 2

    read = await notifications.mark_read(second, owner)
    assert read.read_at is not None
    assert (await notifications.mark_read(second, owner)).read_at == read.read_at
    assert (await notifications.unread_count(owner)).count == 1
    assert [n.id for n in await notifications.list_notifications(owner, unread_only=True)] == [
        first
    ]

    # Main keeps completed playback available while a replacement is being generated.
    await conn.execute("update storytime set status = 'rendering' where id = $1", storytime_id)
    assert len(await notifications.list_notifications(owner)) == 2
    assert await visible(conn, seed.user_id, "select count(*) from notification") == 2


async def test_storytime_notifications_enforce_recipient_and_current_source_access(conn, seed):
    request_id, story_id, storytime_id, video_id = await completed_storytime(conn, seed)
    notification_id = await add_storytime_notification(conn, seed.narrator_id, story_id, request_id)
    relative, _ = await add_member(conn, seed.family_id, "Another member")
    other_family, outsider, _ = await add_other_family(conn)

    for user_id in (relative, outsider):
        user = User(user_id)
        assert await notifications.list_notifications(user) == []
        assert (await notifications.unread_count(user)).count == 0
        with pytest.raises(HTTPException) as hidden:
            await notifications.mark_read(notification_id, user)
        assert hidden.value.status_code == 404
        assert await visible(conn, user_id, "select count(*) from notification") == 0

    # A second family membership cannot retain access after source-family membership removal.
    other_person = await conn.fetchval(
        "insert into person (family_id, display_name) values ($1, 'Second identity') returning id",
        other_family,
    )
    await conn.execute(
        "insert into member (user_id, family_id, person_id) values ($1, $2, $3)",
        seed.user_id,
        other_family,
        other_person,
    )
    await add_storytime_notification(conn, other_person, story_id)
    await conn.execute(
        "delete from member where user_id = $1 and family_id = $2", seed.user_id, seed.family_id
    )
    owner = User(seed.user_id)
    assert await notifications.list_notifications(owner) == []
    assert (await notifications.unread_count(owner)).count == 0
    with pytest.raises(HTTPException) as removed:
        await notifications.mark_read(notification_id, owner)
    assert removed.value.status_code == 404
    assert await visible(conn, seed.user_id, "select count(*) from notification") == 0

    await conn.execute(
        "insert into member (user_id, family_id, person_id, role) values ($1, $2, $3, 'owner')",
        seed.user_id,
        seed.family_id,
        seed.narrator_id,
    )
    await conn.execute("update story set status = 'draft' where id = $1", story_id)
    assert await notifications.list_notifications(owner) == []
    assert (await notifications.unread_count(owner)).count == 0
    assert await visible(conn, seed.user_id, "select count(*) from notification") == 0
    await conn.execute("update story set status = 'published' where id = $1", story_id)
    await conn.execute("update storytime set video_media_id = null where id = $1", storytime_id)
    assert await notifications.list_notifications(owner) == []
    assert (await notifications.unread_count(owner)).count == 0
    assert await visible(conn, seed.user_id, "select count(*) from notification") == 0
    await conn.execute("delete from media where id = $1", video_id)
    await conn.execute("delete from story where id = $1", story_id)
    assert await notifications.list_notifications(owner) == []
    assert (await notifications.unread_count(owner)).count == 0


async def test_account_recipient_shape_stays_nullable_and_story_destination_uses_story(conn, seed):
    recipient = await add_user(conn, "future-member@example.com")
    invite_id = await conn.fetchval(
        "insert into family_invite (family_id, inviter_user_id, anchor_person_id, kind, email) "
        "values ($1, $2, $3, 'sibling', 'future-member@example.com') returning id",
        seed.family_id,
        seed.user_id,
        seed.narrator_id,
    )
    await notifications.create_notification(
        conn, ntype="invite_received", recipient_user_id=recipient.id, invite_id=invite_id
    )
    invitation = (await notifications.list_notifications(recipient))[0]
    assert invitation.recipient_id is None and invitation.heirloom_id is None
    assert invitation.destination_id == invite_id

    _, story_id, _, _ = await completed_storytime(conn, seed)
    _, outsider, foreign_person = await add_other_family(conn)
    foreign_heirloom = await conn.fetchval(
        "insert into heirloom (family_id, created_by, title) "
        "select family_id, $1, 'Private foreign title' from person where id = $2 returning id",
        outsider,
        foreign_person,
    )
    foreign_listener = await conn.fetchval(
        "insert into person (family_id, display_name) "
        "select family_id, 'Private listener' from person where id = $1 returning id",
        foreign_person,
    )
    unrelated_request = await conn.fetchval(
        "insert into story_request (heirloom_id, listener_id, storyteller_id) "
        "values ($1, $2, $3) returning id",
        foreign_heirloom,
        foreign_listener,
        foreign_person,
    )
    await add_storytime_notification(conn, seed.narrator_id, story_id, unrelated_request)
    note = (await notifications.list_notifications(User(seed.user_id)))[0]
    assert note.heirloom_id == seed.heirloom_id
    assert note.destination_id == seed.heirloom_id
    assert note.request_id is None
    assert "Private foreign title" not in note.message
