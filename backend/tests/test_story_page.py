"""The story page carries everything it shows: the teller's recordings, names, photos, notes."""

import pytest

from app.auth import User
from app.routers import stories
from tests.test_live_pipeline import add_answer, start_interview


@pytest.fixture(autouse=True)
def fake_urls(monkeypatch):
    async def signed(bucket, path, expires_in=3600):
        return f"https://storage.test/{bucket}/{path}"

    monkeypatch.setattr(stories, "signed_download_url", signed)


async def test_the_story_plays_back_in_the_tellers_voice_in_order(conn, fakes, seed):
    interview_id = await start_interview(conn, seed, state="done")
    first, _ = await add_answer(conn, fakes, seed, interview_id, idx=1, text="My mother.")
    await conn.execute(
        "insert into turn (interview_id, idx, role, text) values ($1, 2, 'question', 'When?')",
        interview_id,
    )
    second, _ = await add_answer(conn, fakes, seed, interview_id, idx=3, text="In 1961.")
    abandoned, _ = await add_answer(conn, fakes, seed, interview_id, idx=5)
    for turn_id, text in ((second, "In 1961."), (first, "My mother.")):
        await conn.execute(
            "insert into segment (turn_id, start_ms, end_ms, text) values ($1, 0, 900, $2)",
            turn_id,
            text,
        )
    note = await conn.fetchval(
        "insert into memory_note (heirloom_id, author_id, text) "
        "values ($1, $2, 'She wore it every Sunday.') returning id",
        seed.heirloom_id,
        seed.narrator_id,
    )
    await conn.execute(
        "insert into story (heirloom_id, version, title, blocks) values ($1, 1, 'The ring', '[]')",
        seed.heirloom_id,
    )

    story = await stories.get_story(seed.heirloom_id, User(id=seed.user_id))

    assert [(r.turn_id, r.question) for r in story.recordings] == [
        (first, "Who gave you this ring?"),
        (second, "When?"),
    ], "answers with no words heard are left out"
    assert story.recordings[0].audio_url.startswith("https://storage.test/audio/")
    assert story.people == {seed.narrator_id: "Nani"}
    assert story.photos[seed.photo_id].startswith("https://storage.test/photos/")
    assert story.memories == {note: "She wore it every Sunday."}
