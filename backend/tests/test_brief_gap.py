"""Brief gap tables: profile prefs, story_request transitions, notifications."""

from uuid import uuid4

import asyncpg
import pytest

from app.routers.profiles import default_mode


def test_default_mode():
    assert default_mode(None) == "simplified"
    assert default_mode(10) == "regular"
    assert default_mode(18 - 1) == "regular"
    assert default_mode(18) == "simplified"
    assert default_mode(50) == "simplified"
    assert default_mode(51) == "extra_simple"


async def test_request_lifecycle(conn, seed):
    listener, teller = seed.narrator_id, uuid4()
    await conn.execute(
        "insert into person (id, family_id, display_name) values ($1, $2, 'Grandpa')",
        teller,
        seed.family_id,
    )
    req = await conn.fetchrow(
        "insert into story_request (heirloom_id, capture_media_id, listener_id, storyteller_id, "
        "message, idempotency_key) values ($1, $2, $3, $4, $5, $6) returning id, status",
        seed.heirloom_id,
        seed.photo_id,
        listener,
        teller,
        "Grandpa, who gave you this watch?",
        "key-1",
    )
    assert req["status"] == "pending"
    # idempotency: second insert with same key fails unique
    with pytest.raises(asyncpg.UniqueViolationError):
        await conn.execute(
            "insert into story_request "
            "(heirloom_id, listener_id, storyteller_id, idempotency_key) "
            "values ($1, $2, $3, $4)",
            seed.heirloom_id,
            listener,
            teller,
            "key-1",
        )
    # self-request forbidden
    with pytest.raises(asyncpg.CheckViolationError):
        await conn.execute(
            "insert into story_request "
            "(heirloom_id, listener_id, storyteller_id) values ($1, $2, $2)",
            seed.heirloom_id,
            listener,
        )
    await conn.execute("update story_request set status = 'in_progress' where id = $1", req["id"])
    await conn.execute(
        "insert into notification (recipient_id, type, request_id) "
        "values ($1, 'request_received', $2)",
        teller,
        req["id"],
    )
    n = await conn.fetchrow(
        "select type, read_at from notification where request_id = $1", req["id"]
    )
    assert n["type"] == "request_received" and n["read_at"] is None
    await conn.execute("update story_request set status = 'completed' where id = $1", req["id"])
    row = await conn.fetchrow("select status from story_request where id = $1", req["id"])
    assert row["status"] == "completed"


async def test_profile_upsert(conn, seed):
    await conn.execute(
        "insert into profile (user_id, display_name, age, ui_mode) "
        "values ($1, 'KC', 72, 'extra_simple')",
        seed.user_id,
    )
    r = await conn.fetchrow("select age, ui_mode from profile where user_id = $1", seed.user_id)
    assert (r["age"], r["ui_mode"]) == (72, "extra_simple")
