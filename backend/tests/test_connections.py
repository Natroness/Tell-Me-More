"""Family and Friends between real accounts: requests, per-viewer labels, and shared archives."""

from dataclasses import dataclass
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException

from app.accounts import ACCOUNT_NAME
from app.auth import User
from app.routers import connections, families, requests, stories
from app.routers.connections import Choice, SendRequest


@dataclass
class Account:
    user: User
    family_id: UUID
    person_id: UUID
    heirloom_id: UUID


@pytest.fixture(autouse=True)
def fake_urls(monkeypatch):
    async def signed(bucket, path, expires_in=3600):
        return f"https://storage.test/{bucket}/{path}"

    monkeypatch.setattr(stories, "signed_download_url", signed)


async def account(conn, name: str, story: str | None = None) -> Account:
    """A signed-up user with their own family, one photographed object, and maybe its story."""
    user_id = uuid4()
    await conn.execute("insert into auth.users values ($1)", user_id)
    family_id = await conn.fetchval(
        "insert into family (name, invite_code) values ($1, $2) returning id",
        f"{name}'s family",
        uuid4().hex[:8],
    )
    person_id = await conn.fetchval(
        "insert into person (family_id, display_name) values ($1, $2) returning id",
        family_id,
        name,
    )
    await conn.execute(
        "insert into member values ($1, $2, $3, 'owner')", user_id, family_id, person_id
    )
    heirloom_id = await conn.fetchval(
        "insert into heirloom (family_id, title, created_by) values ($1, $2, $3) returning id",
        family_id,
        f"{name}'s watch",
        user_id,
    )
    if story:
        await conn.execute(
            "insert into story (heirloom_id, version, title, blocks) values ($1, 1, $2, '[]')",
            heirloom_id,
            story,
        )
    return Account(User(user_id), family_id, person_id, heirloom_id)


async def befriend(a: Account, b: Account, a_sees_b="friend", b_sees_a="friend"):
    sent = await connections.send_request(SendRequest(user_id=b.user.id, kind=a_sees_b), a.user)
    await connections.accept(sent.id, Choice(kind=b_sees_a), b.user)


async def test_each_person_keeps_their_own_label(conn):
    jimmy, jaeden = await account(conn, "Jimmy Doe"), await account(conn, "Jaeden McAdams")

    sent = await connections.send_request(
        SendRequest(user_id=jaeden.user.id, kind="friend"), jimmy.user
    )
    inbox = await connections.list_requests(jaeden.user)
    assert [(r.display_name, r.kind) for r in inbox.incoming] == [("Jimmy Doe", "friend")]
    assert (await connections.list_requests(jimmy.user)).outgoing[
        0
    ].display_name == "Jaeden McAdams"
    assert await connections.list_connections(jimmy.user) == [], "nothing until they accept"

    await connections.accept(sent.id, Choice(kind="family"), jaeden.user)

    jimmys = await connections.list_connections(jimmy.user)
    jaedens = await connections.list_connections(jaeden.user)
    assert [(c.display_name, c.kind) for c in jimmys] == [("Jaeden McAdams", "friend")]
    assert [(c.display_name, c.kind) for c in jaedens] == [("Jimmy Doe", "family")]

    await connections.relabel(jaeden.user.id, Choice(kind="family"), jimmy.user)
    await connections.relabel(jimmy.user.id, Choice(kind="friend"), jaeden.user)
    assert (await connections.list_connections(jimmy.user))[0].kind == "family"
    assert (await connections.list_connections(jaeden.user))[0].kind == "friend"
    with pytest.raises(HTTPException) as e:
        await connections.relabel(uuid4(), Choice(kind="family"), jimmy.user)
    assert e.value.status_code == 404


async def test_everyone_lands_in_the_family_they_own(conn):
    jimmy, jaeden = await account(conn, "Jimmy"), await account(conn, "Jaeden")
    await befriend(jimmy, jaeden)

    assert (await families.list_families(jaeden.user))[0].id == jaeden.family_id
    assert (await families.list_families(jimmy.user))[0].id == jimmy.family_id
    assert (await connections.me(jaeden.user)).display_name == "Jaeden"


async def test_connected_people_read_each_others_archives(conn):
    jimmy = await account(conn, "Jimmy", story="Jimmy's landing gear")
    jaeden = await account(conn, "Jaeden", story="The wooden picnic knife")

    with pytest.raises(HTTPException) as e:
        await stories.archive(jimmy.user, user_id=jaeden.user.id)
    assert e.value.status_code == 404, "strangers' archives stay closed"

    await befriend(jimmy, jaeden)

    theirs = await stories.archive(jimmy.user, user_id=jaeden.user.id)
    assert [s.title for s in theirs] == ["The wooden picnic knife"]
    assert [s.title for s in await stories.archive(jaeden.user, user_id=jimmy.user.id)] == [
        "Jimmy's landing gear"
    ]
    assert [s.title for s in await stories.archive(jimmy.user)] == ["Jimmy's landing gear"]
    assert (await connections.list_connections(jimmy.user))[0].story_count == 1
    opened = await stories.get_story(jaeden.heirloom_id, jimmy.user)
    assert opened.title == "The wooden picnic knife"


async def test_a_story_you_told_on_someone_elses_object_is_in_your_archive(conn):
    jimmy, jaeden = (
        await account(conn, "Jimmy", story="Jimmy's watch"),
        await account(conn, "Jaeden"),
    )
    await befriend(jimmy, jaeden)
    jaeden_in_jimmys = await conn.fetchval(
        "select person_id from member where user_id = $1 and family_id = $2",
        jaeden.user.id,
        jimmy.family_id,
    )
    await conn.execute(
        "insert into interview (heirloom_id, narrator_id, interviewer_user_id, state) "
        "values ($1, $2, $3, 'done')",
        jimmy.heirloom_id,
        jaeden_in_jimmys,
        jaeden.user.id,
    )

    told = await stories.archive(jaeden.user)
    assert [(s.title, s.storyteller_name) for s in told] == [("Jimmy's watch", "Jaeden")]


async def test_people_lists_hold_only_real_accounts(conn):
    jimmy, jaeden = await account(conn, "Jimmy"), await account(conn, "Jaeden")
    await conn.execute(
        "insert into person (family_id, display_name, relation_label) "
        "values ($1, 'Jade', 'Friend')",
        jimmy.family_id,
    )
    await befriend(jimmy, jaeden, a_sees_b="family")

    people = await families.list_people(jimmy.family_id, jimmy.user)
    assert [(p.display_name, p.relation) for p in people] == [
        ("Jimmy", "you"),
        ("Jaeden", "family"),
    ]
    found = await families.search_people(jimmy.family_id, jimmy.user, q="Ja")
    assert [p.display_name for p in found] == ["Jaeden"]


async def test_search_finds_only_people_you_could_still_ask(conn):
    jimmy = await account(conn, "Jimmy")
    jaeden, jade = await account(conn, "Jaeden"), await account(conn, "Jade")
    await conn.execute("insert into auth.users values ($1)", uuid4())  # no name anywhere

    assert await connections.search_users(jimmy.user, q="J") == [], "two letters minimum"
    assert {a.display_name for a in await connections.search_users(jimmy.user, q="ja")} == {
        "Jaeden",
        "Jade",
    }
    assert await connections.search_users(jimmy.user, q="jimmy") == [], "never yourself"

    await connections.send_request(SendRequest(user_id=jade.user.id), jimmy.user)
    await befriend(jimmy, jaeden)
    assert await connections.search_users(jimmy.user, q="ja") == []


async def test_requests_are_strict(conn):
    jimmy, jaeden, stranger = (
        await account(conn, "Jimmy"),
        await account(conn, "Jaeden"),
        await account(conn, "Stranger"),
    )

    for body, code in (
        (SendRequest(user_id=jimmy.user.id), 400),
        (SendRequest(user_id=uuid4()), 404),
    ):
        with pytest.raises(HTTPException) as e:
            await connections.send_request(body, jimmy.user)
        assert e.value.status_code == code

    sent = await connections.send_request(SendRequest(user_id=jaeden.user.id), jimmy.user)
    with pytest.raises(HTTPException) as e:
        await connections.send_request(SendRequest(user_id=jaeden.user.id), jimmy.user)
    assert e.value.status_code == 409
    for outsider in (jimmy, stranger):
        with pytest.raises(HTTPException) as e:
            await connections.accept(sent.id, Choice(), outsider.user)
        assert e.value.status_code == 404, "only the person asked can answer"

    back = await connections.send_request(SendRequest(user_id=jimmy.user.id), jaeden.user)
    assert back.status == "accepted", "asking back accepts the open request"
    with pytest.raises(HTTPException) as e:
        await connections.send_request(SendRequest(user_id=jaeden.user.id), jimmy.user)
    assert e.value.status_code == 409


async def test_declined_requests_connect_nobody(conn):
    jimmy, jaeden = await account(conn, "Jimmy"), await account(conn, "Jaeden")
    sent = await connections.send_request(SendRequest(user_id=jaeden.user.id), jimmy.user)
    await connections.decline(sent.id, jaeden.user)

    assert await connections.list_connections(jimmy.user) == []
    assert (await connections.list_requests(jaeden.user)).incoming == []
    again = await connections.send_request(SendRequest(user_id=jaeden.user.id), jimmy.user)
    assert again.status == "pending"


async def test_a_story_request_reaches_a_connection_from_their_own_home(conn):
    jimmy, jaeden = await account(conn, "Jimmy"), await account(conn, "Jaeden")
    await befriend(jimmy, jaeden)
    teller = next(
        p for p in await families.list_people(jimmy.family_id, jimmy.user) if p.relation != "you"
    )
    await conn.execute(
        "insert into story_request (heirloom_id, listener_id, storyteller_id) values ($1, $2, $3)",
        jimmy.heirloom_id,
        jimmy.person_id,
        teller.id,
    )

    incoming = await requests.list_requests(jaeden.user, scope="incoming")
    assert [r.heirloom_id for r in incoming] == [jimmy.heirloom_id]
    assert await requests.list_requests(jaeden.user, scope="mine") == []
    assert len(await requests.list_requests(jimmy.user, scope="mine")) == 1


async def test_names_resolve_inside_any_callers_query(conn):
    jimmy, jaeden = await account(conn, "Jimmy"), await account(conn, "Jaeden")
    rows = await conn.fetch(
        f"select m.user_id, {ACCOUNT_NAME.format(user='m.user_id')} as name from member m"
    )
    assert {r["user_id"]: r["name"] for r in rows} == {
        jimmy.user.id: "Jimmy",
        jaeden.user.id: "Jaeden",
    }
