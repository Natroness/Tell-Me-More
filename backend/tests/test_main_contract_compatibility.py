"""Main-feature account contracts remain compatible with supporting family/preferences APIs."""

from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException

from app.auth import User
from app.routers import families, profiles, requests
from app.routers.families import CreateFamily, CreatePerson
from app.routers.profiles import UpdateProfile


async def _member(conn, family_id, name):
    user_id = uuid4()
    await conn.execute("insert into auth.users (id) values ($1)", user_id)
    person_id = await conn.fetchval(
        "insert into person (family_id, display_name) values ($1, $2) returning id",
        family_id,
        name,
    )
    await conn.execute(
        "insert into member (user_id, family_id, person_id) values ($1, $2, $3)",
        user_id,
        family_id,
        person_id,
    )
    return User(user_id), person_id


async def _request(conn, heirloom_id, listener_id, storyteller_id):
    return await conn.fetchval(
        "insert into story_request (heirloom_id, listener_id, storyteller_id) "
        "values ($1, $2, $3) returning id",
        heirloom_id,
        listener_id,
        storyteller_id,
    )


@pytest.mark.parametrize("has_family", [True, False])
async def test_preference_only_updates_preserve_chosen_account_name(conn, seed, has_family):
    user = User(seed.user_id)
    if not has_family:
        await conn.execute("delete from member where user_id = $1", user.id)
    await profiles.update_profile(UpdateProfile(display_name="Chosen account name", age=72), user)

    changed = await profiles.update_profile(
        UpdateProfile(ui_mode="regular", preferred_language="es"), user
    )
    assert changed.display_name == "Chosen account name"
    assert (
        changed.age,
        changed.ui_mode,
        changed.ui_mode_is_manual,
        changed.preferred_language,
    ) == (
        72,
        "regular",
        True,
        "es",
    )
    aged = await profiles.update_profile(UpdateProfile(age=80), user)
    loaded = await profiles.get_profile(user)
    assert aged == loaded
    assert loaded.display_name == "Chosen account name"
    assert loaded.ui_mode == "regular"


async def test_people_search_keeps_accounts_selectable_and_name_only_relatives_in_tree(conn, seed):
    owner = User(seed.user_id)
    relative, person_id = await _member(conn, seed.family_id, "Rae")
    await conn.execute("update person set full_name = 'Rae Santos' where id = $1", person_id)
    named = await families.create_person(
        CreatePerson(family_id=seed.family_id, display_name="Named-only relative"), owner
    )
    await conn.execute(
        "insert into relationship (family_id, a, b, kind) values ($1, $2, $3, 'parent')",
        seed.family_id,
        person_id,
        named.id,
    )
    await conn.execute(
        "insert into connection (user_id, other_id, kind) values ($1, $2, 'friend')",
        owner.id,
        relative.id,
    )

    selectable = {person.id: person for person in await families.list_people(seed.family_id, owner)}
    assert set(selectable) == {seed.narrator_id, person_id}
    assert selectable[seed.narrator_id].relation == "you"
    assert (selectable[person_id].full_name, selectable[person_id].degree) == ("Rae Santos", 1)
    assert selectable[person_id].relation == "friend"
    found = await families.search_people(seed.family_id, owner, q="Santos")
    assert [person.id for person in found] == [person_id]
    assert await families.search_people(seed.family_id, owner, q="Named-only") == []

    tree = await families.get_tree(seed.family_id, owner)
    assert tree.me == seed.narrator_id
    assert {person.id for person in tree.people} == {seed.narrator_id, person_id, named.id}
    assert set(tree.member_person_ids) == {seed.narrator_id, person_id}
    assert [(edge.a, edge.b, edge.kind) for edge in tree.relationships] == [
        (person_id, named.id, "parent")
    ]

    outsider_id = uuid4()
    await conn.execute("insert into auth.users (id) values ($1)", outsider_id)
    with pytest.raises(HTTPException) as denied:
        await families.search_people(seed.family_id, User(outsider_id), q="Santos")
    assert denied.value.status_code == 403


async def test_home_family_priority_and_profile_fallback_survive_multiple_memberships(conn, seed):
    user, _ = await _member(conn, seed.family_id, "Guest name")
    home = await families.create_family(
        CreateFamily(name="Home", your_name="Home account name"), user
    )
    assert [family.id for family in await families.list_families(user)] == [home.id, seed.family_id]
    assert (await profiles.get_profile(user)).display_name == "Home account name"
    updated = await profiles.update_profile(UpdateProfile(preferred_language="hi"), user)
    assert updated.display_name == "Home account name"
    assert updated.preferred_language == "hi"


async def test_request_inbox_spans_families_for_participating_current_members(conn, seed):
    user = User(seed.user_id)
    _, relative = await _member(conn, seed.family_id, "Relative")
    _, other = await _member(conn, seed.family_id, "Other relative")
    sent = await _request(conn, seed.heirloom_id, seed.narrator_id, relative)
    incoming = await _request(conn, seed.heirloom_id, other, seed.narrator_id)
    unrelated = await _request(conn, seed.heirloom_id, relative, other)

    second = await families.create_family(CreateFamily(name="Second", your_name="Second me"), user)
    second_person = (await families.get_tree(second.id, user)).me
    _, second_relative = await _member(conn, second.id, "Second relative")
    second_heirloom = await conn.fetchval(
        "insert into heirloom (family_id, created_by) values ($1, $2) returning id",
        second.id,
        user.id,
    )
    second_sent = await _request(conn, second_heirloom, second_person, second_relative)

    inbox = await requests.list_requests(user)
    assert {item.id for item in inbox} == {sent, incoming, second_sent}
    assert unrelated not in {item.id for item in inbox}
    assert {item.id for item in await requests.list_requests(user, scope="mine")} == {
        sent,
        second_sent,
    }
    assert [item.id for item in await requests.list_requests(user, scope="incoming")] == [incoming]
    scoped = await requests.list_requests(user, family_id=seed.family_id)
    assert {item.id for item in scoped} == {sent, incoming}
    with pytest.raises(HTTPException) as denied:
        await requests.list_requests(user, family_id=uuid4())
    assert denied.value.status_code == 403

    await conn.execute(
        "delete from member where user_id = $1 and family_id = $2", user.id, seed.family_id
    )
    assert [item.id for item in await requests.list_requests(user)] == [second_sent]


async def test_request_detail_names_viewer_role_in_the_request_family(conn, seed, monkeypatch):
    async def signed_url(bucket, path):
        return f"https://storage.test/{bucket}/{path}"

    monkeypatch.setattr(requests, "signed_download_url", signed_url)
    # The storyteller's first family is not the request's family; the role must still resolve.
    teller, teller_person = await _member(conn, seed.family_id, "Jimmy")
    await families.create_family(CreateFamily(name="Jimmy home", your_name="Jimmy"), teller)
    assert (await families.list_families(teller))[0].id != seed.family_id
    bystander, _ = await _member(conn, seed.family_id, "Bystander")
    request_id = await _request(conn, seed.heirloom_id, seed.narrator_id, teller_person)

    assert (await requests.get_request(request_id, teller)).viewer_role == "storyteller"
    assert (await requests.get_request(request_id, User(seed.user_id))).viewer_role == "listener"
    assert (await requests.get_request(request_id, bystander)).viewer_role == "member"


def test_request_family_filter_is_optional_in_the_api_contract():
    api = FastAPI()
    api.include_router(requests.router)
    parameters = api.openapi()["paths"]["/api/requests"]["get"]["parameters"]
    family_filter = next(parameter for parameter in parameters if parameter["name"] == "family_id")
    assert family_filter["required"] is False
