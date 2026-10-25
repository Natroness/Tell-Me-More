"""Dev passwordless login resolves real accounts by email, else mints a dev identity."""

from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.auth import dev_user_from_token, dev_user_id_for_email
from app.config import get_settings
from app.routers import dev_auth
from app.routers.dev_auth import DevLoginRequest


@pytest.fixture
def dev_enabled(monkeypatch):
    monkeypatch.setenv("DEV_PASSWORDLESS_LOGIN", "true")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


async def test_dev_login_resolves_existing_user_by_email(conn, dev_enabled):
    real_id = uuid4()
    await conn.execute(
        "insert into auth.users (id, email) values ($1, $2)", real_id, "User@Example.com"
    )
    res = await dev_auth.dev_login(DevLoginRequest(email="user@example.com"))
    assert res.user_id == str(real_id)
    assert res.email == "user@example.com"
    assert dev_user_from_token(res.access_token) is not None
    assert dev_user_from_token(res.access_token).id == real_id


async def test_dev_login_mints_stable_identity_for_unknown_email(conn, dev_enabled):
    res = await dev_auth.dev_login(DevLoginRequest(email="new@example.com"))
    assert res.user_id == str(dev_user_id_for_email("new@example.com"))
    assert await conn.fetchval("select id from auth.users where id = $1", res.user_id) is not None
    # Same email, same account.
    again = await dev_auth.dev_login(DevLoginRequest(email="new@example.com"))
    assert again.user_id == res.user_id


async def test_dev_login_404_when_disabled(conn, monkeypatch):
    monkeypatch.setenv("DEV_PASSWORDLESS_LOGIN", "false")
    get_settings.cache_clear()
    try:
        with pytest.raises(HTTPException) as denied:
            await dev_auth.dev_login(DevLoginRequest(email="x@example.com"))
        assert denied.value.status_code == 404
    finally:
        get_settings.cache_clear()
