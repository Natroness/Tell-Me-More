"""Accepted connections can be placed, with stable identities and directed family roles."""

import asyncio

import pytest
from fastapi import HTTPException

from app.routers import families, invites
from app.routers.families import AddTreeConnection
from tests.test_connections import account, befriend
from tests.test_invites import add_user, new_family


async def place(owner, target, kind, *, family=None, anchor=None):
    return await families.add_tree_connection(
        family or owner.family_id,
        AddTreeConnection(
            user_id=target.user.id, anchor_person_id=anchor or owner.person_id, kind=kind
        ),
        owner.user,
    )


async def test_connected_people_reuse_their_membership_and_store_roles(conn):
    owner, jimmy, dad = [await account(conn, name) for name in ("Morgan", "Jimmy", "Big Guy")]
    await befriend(owner, jimmy, "family", "family")
    await befriend(owner, dad, "family", "family")
    before = await conn.fetchval("select count(*) from person")
    choices = await families.tree_connections(owner.family_id, owner.user)
    assert {c.user_id for c in choices} == {jimmy.user.id, dad.user.id}
    assert all(c.person_id for c in choices)
    child = await place(owner, jimmy, "son")
    parent = await place(owner, dad, "father")
    assert (child.a, child.b_role, parent.b, parent.a_role) == (
        owner.person_id,
        "son",
        owner.person_id,
        "dad",
    )
    assert await conn.fetchval("select count(*) from person") == before
    tree = await families.get_tree(owner.family_id, owner.user)
    assert {e.kind for e in tree.relationships} == {"parent"}
    assert len(tree.relationships) == 2


async def test_repeated_and_concurrent_placement_keeps_one_edge(conn):
    owner, kid = await account(conn, "Morgan"), await account(conn, "Jimmy")
    await befriend(owner, kid)
    first, second = await asyncio.gather(place(owner, kid, "child"), place(owner, kid, "child"))
    assert first == second
    updated = await place(owner, kid, "son")
    assert updated.b_role == "son"
    assert await conn.fetchval("select count(*) from relationship") == 1


@pytest.mark.parametrize(
    "kind,edge_kind,role",
    [
        ("grandfather", "grandparent", "grandpa"),
        ("grandmother", "grandparent", "grandma"),
        ("friend", "friend", "friend"),
    ],
)
async def test_extended_roles_keep_canonical_direction(conn, kind, edge_kind, role):
    owner, relative = await account(conn, "Morgan"), await account(conn, "Alex")
    await befriend(owner, relative)
    edge = await place(owner, relative, kind)
    assert edge.b == owner.person_id
    assert (edge.kind, edge.a_role) == (edge_kind, role)


async def test_unconnected_foreign_anchor_and_nonmembers_cannot_write(conn):
    owner, connected, stranger = [await account(conn, name) for name in ("Morgan", "Alex", "Other")]
    await befriend(owner, connected)
    for target, family, anchor, code in [
        (stranger, owner.family_id, owner.person_id, 403),
        (connected, owner.family_id, stranger.person_id, 404),
        (connected, stranger.family_id, stranger.person_id, 403),
    ]:
        with pytest.raises(HTTPException) as error:
            await place(owner, target, "parent", family=family, anchor=anchor)
        assert error.value.status_code == code
    assert await conn.fetchval("select count(*) from relationship") == 0
    # Membership in a second family is never silently granted by placing a connection.
    second, _ = await new_family(conn, owner.user, "Morgan")
    with pytest.raises(HTTPException) as error:
        await place(
            owner,
            connected,
            "friend",
            family=second,
            anchor=(await families.get_tree(second, owner.user)).me,
        )
    assert error.value.status_code == 409
    assert not await conn.fetchval(
        "select 1 from member where user_id=$1 and family_id=$2", connected.user.id, second
    )


async def test_grandparent_cycles_and_inconsistent_generations_are_rejected(conn):
    owner, parent, grandparent = [await account(conn, n) for n in ("Morgan", "Dad", "Grandpa")]
    await befriend(owner, parent)
    await befriend(owner, grandparent)
    await place(owner, parent, "parent")
    p = await conn.fetchval(
        "select person_id from member where user_id=$1 and family_id=$2",
        parent.user.id,
        owner.family_id,
    )
    await place(owner, grandparent, "parent", anchor=p)
    with pytest.raises(HTTPException) as error:
        await place(owner, grandparent, "child")
    assert error.value.status_code == 409
    with pytest.raises(HTTPException) as error:
        await place(owner, grandparent, "parent")  # Already two generations up.
    assert error.value.status_code == 409


async def test_third_parent_is_rejected(conn):
    owner = await account(conn, "Morgan")
    parents = [await account(conn, name) for name in ("One", "Two", "Three")]
    for parent in parents:
        await befriend(owner, parent)
    await place(owner, parents[0], "parent")
    await place(owner, parents[1], "parent")
    with pytest.raises(HTTPException) as error:
        await place(owner, parents[2], "parent")
    assert error.value.status_code == 409


async def test_stale_membership_cannot_link_a_person_from_another_family(conn):
    owner, connected, outsider = [await account(conn, n) for n in ("Morgan", "Alex", "Other")]
    await befriend(owner, connected)
    await conn.execute(
        "update member set person_id=$3 where user_id=$1 and family_id=$2",
        connected.user.id,
        owner.family_id,
        outsider.person_id,
    )
    choices = await families.tree_connections(owner.family_id, owner.user)
    assert choices[0].person_id is None
    with pytest.raises(HTTPException) as error:
        await place(owner, connected, "friend")
    assert error.value.status_code == 409
    assert not await conn.fetchval("select count(*) from relationship")


async def test_grandparent_invitation_is_still_accepted_by_the_recipient(conn):
    owner = await add_user(conn, "morgan@example.com")
    grandpa = await add_user(conn, "grandpa@example.com")
    fid, anchor = await new_family(conn, owner)
    invitation = await invites.create_invite(
        fid,
        invites.CreateInvite(
            anchor_person_id=anchor,
            kind="grandfather",
            email="grandpa@example.com",
        ),
        owner,
    )
    assert not (await families.get_tree(fid, owner)).relationships
    accepted = await invites.accept_invite(invitation.id, grandpa)
    edge = (await families.get_tree(fid, owner)).relationships[0]
    assert (edge.a, edge.b, edge.kind, edge.a_role) == (
        accepted.person_id,
        anchor,
        "grandparent",
        "grandpa",
    )
