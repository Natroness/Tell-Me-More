"""One shared family: connected relatives see the same objects, dates, timeline, availability,
tree and avatars, and can switch between the families they belong to."""

from datetime import date
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app import storage
from app.auth import User
from app.routers import (
    availability,
    connections,
    events,
    families,
    heirlooms,
    invites,
    profiles,
    timeline,
)
from app.routers.availability import UpdateAvailabilitySettings
from app.routers.connections import Choice, SendRequest
from app.routers.events import CreateEvent
from app.routers.families import ChooseFamily, CreateFamily
from app.routers.invites import CreateInvite
from app.routers.profiles import FinishAvatarUpload, StartAvatarUpload, UpdateProfile
from tests.test_brief_fixes import visible


async def add_user(conn, email: str) -> User:
    user = User(id=uuid4())
    await conn.execute(
        "insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())",
        user.id,
        email,
    )
    return user


async def status_of(call) -> int:
    with pytest.raises(HTTPException) as e:
        await call
    return e.value.status_code


async def own_family(user: User, name: str):
    return await families.create_family(CreateFamily(name=name, your_name=name), user)


async def befriend(a: User, b: User, kind="family"):
    sent = await connections.send_request(SendRequest(user_id=b.id, kind=kind), a)
    await connections.accept(sent.id, Choice(kind=kind), b)


async def active(user: User):
    return (await families.list_families(user))[0]


async def test_second_member_sees_first_members_media_dates_timeline_and_availability(
    conn, seed, monkeypatch
):
    # heirlooms imported the real signer before the fakes fixture replaced it.
    monkeypatch.setattr(heirlooms, "signed_download_url", storage.signed_download_url)
    owner = User(seed.user_id)
    relative = await add_user(conn, "relative@example.com")
    their_own = await own_family(relative, "Relative")

    await befriend(owner, relative)

    # Both were alone, so the sender's family becomes the one both look at.
    assert (await active(relative)).id == seed.family_id
    assert (await active(relative)).is_active
    assert (await active(owner)).id == seed.family_id
    assert {f.id for f in await families.list_families(relative)} == {
        seed.family_id,
        their_own.id,
    }

    shelf = await heirlooms.list_heirlooms(seed.family_id, relative)
    assert [h.id for h in shelf] == [seed.heirloom_id]
    assert shelf[0].cover_url, "the relative gets a URL for the owner's photo"
    path = f"{seed.family_id}/{seed.heirloom_id}/{seed.photo_id}.jpg"
    assert await visible(conn, relative.id, "select count(*) from media") == 1
    assert await visible(
        conn, relative.id, f"select private.can_read_storage_object('photos', '{path}')::int"
    )

    event = await events.create_event(
        seed.family_id,
        CreateEvent(title="Nani's birthday", category="birthday", date=date(2026, 11, 2)),
        owner,
    )
    seen = await events.list_events(seed.family_id, date(2026, 11, 1), date(2026, 11, 30), relative)
    assert [e.id for e in seen] == [event.id]
    assert await visible(conn, relative.id, "select count(*) from family_event") == 1

    page = await timeline.list_timeline(
        seed.family_id, date(2026, 1, 1), date(2026, 12, 31), relative
    )
    assert "Nani's birthday" in {item.title for item in page.items}

    await availability.update_availability_settings(
        UpdateAvailabilitySettings(sharing_enabled=True, schedule_configured=True), owner
    )
    statuses = await availability.list_family_availability(seed.family_id, relative)
    assert {s.person_id: s.status for s in statuses}[seed.narrator_id] != "not_shared"


async def test_tree_tables_are_live_for_every_member(conn, seed):
    relative = await add_user(conn, "relative@example.com")
    await befriend(User(seed.user_id), relative)
    live = await conn.fetch(
        "select tablename from pg_publication_tables where pubname = 'supabase_realtime'"
    )
    assert {"person", "relationship", "member", "family_event"} <= {r["tablename"] for r in live}
    # Realtime only delivers rows the subscriber may select.
    assert await visible(conn, relative.id, "select count(*) from person") == 2


async def test_someone_with_relatives_keeps_their_family_and_can_switch(conn, seed):
    owner = User(seed.user_id)
    busy = await add_user(conn, "busy@example.com")
    cousin = await add_user(conn, "cousin@example.com")
    busy_family = await own_family(busy, "Busy")
    await befriend(busy, cousin)
    assert (await active(cousin)).id == busy_family.id

    await befriend(owner, busy)
    assert (await active(busy)).id == busy_family.id, "already shares a family; no surprise"

    chosen = await families.choose_family(ChooseFamily(family_id=seed.family_id), busy)
    assert chosen.is_active and (await active(busy)).id == seed.family_id

    stranger_family = await own_family(await add_user(conn, "x@example.com"), "X")
    assert (
        await status_of(families.choose_family(ChooseFamily(family_id=stranger_family.id), busy))
        == 403
    )


async def test_friends_keep_their_own_view(conn, seed):
    friend = await add_user(conn, "friend@example.com")
    theirs = await own_family(friend, "Friend")
    await befriend(User(seed.user_id), friend, kind="friend")
    assert (await active(friend)).id == theirs.id


async def test_accepting_an_invitation_shows_that_family(conn, seed):
    owner = User(seed.user_id)
    grandpa = await add_user(conn, "grandpa@example.com")
    await own_family(grandpa, "Grandpa")
    sent = await invites.create_invite(
        seed.family_id,
        CreateInvite(anchor_person_id=seed.narrator_id, kind="parent", email="grandpa@example.com"),
        owner,
    )
    await invites.accept_invite(sent.id, grandpa)
    assert (await active(grandpa)).id == seed.family_id


async def test_relatives_see_the_avatar_someone_picks(conn, seed, fakes):
    owner = User(seed.user_id)
    relative = await add_user(conn, "relative@example.com")
    await befriend(owner, relative)

    async def owners_avatar():
        people = await families.list_people(seed.family_id, relative)
        return next(p.avatar_url for p in people if p.id == seed.narrator_id)

    assert await owners_avatar() is None

    saved = await profiles.update_profile(UpdateProfile(age=70, avatar_style="female"), owner)
    assert (saved.avatar_style, saved.avatar_preset, saved.avatar_url) == ("female", None, None)
    assert (await owners_avatar()).endswith(
        "/storage/v1/object/public/avatars/presets/older-woman.png"
    )

    saved = await profiles.update_profile(UpdateProfile(avatar_preset="man"), owner)
    assert saved.avatar_preset == "man" and saved.avatar_style == "female"
    assert (await owners_avatar()).endswith("/avatars/presets/man.png")
    tree = await families.get_tree(seed.family_id, relative)
    assert next(p.avatar_url for p in tree.people if p.id == seed.narrator_id).endswith("man.png")

    started = await profiles.start_avatar_upload(StartAvatarUpload(photo_mime="image/jpeg"), owner)
    assert started.avatar_path.startswith(f"users/{owner.id}/")
    assert (
        await status_of(
            profiles.finish_avatar_upload(
                FinishAvatarUpload(avatar_path=started.avatar_path), owner
            )
        )
        == 422
    ), "nothing was uploaded yet"
    fakes.files[started.avatar_path] = b"\xff\xd8photo"
    fakes.file_mimes[started.avatar_path] = "image/jpeg"
    assert (
        await status_of(
            profiles.finish_avatar_upload(
                FinishAvatarUpload(avatar_path=started.avatar_path), relative
            )
        )
        == 422
    ), "someone else's upload"
    done = await profiles.finish_avatar_upload(
        FinishAvatarUpload(avatar_path=started.avatar_path), owner
    )
    assert done.avatar_url and done.avatar_url.endswith(started.avatar_path)
    assert await owners_avatar() == done.avatar_url

    cleared = await profiles.update_profile(UpdateProfile(avatar_preset=None), owner)
    assert cleared.avatar_preset is None and cleared.avatar_url == done.avatar_url

    removed = await profiles.remove_avatar(owner)
    assert removed.avatar_url is None
    assert started.avatar_path not in fakes.files
    assert (await owners_avatar()).endswith("/avatars/presets/older-woman.png")
    assert (
        await status_of(
            profiles.start_avatar_upload(StartAvatarUpload(photo_mime="text/plain"), owner)
        )
        == 422
    )
