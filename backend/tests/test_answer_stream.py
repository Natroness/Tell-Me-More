"""Streaming answers: the transcript is saved the moment the narrator taps Done."""

import io
import json
import wave
from uuid import uuid4

import jwt
import pytest

from app.auth import User
from app.providers.base import StreamedTranscript
from app.routers import answer_stream
from app.segments import timed_segments
from tests.test_live_pipeline import add_answer, start_interview

SPOKEN = "My father Hari bought it in 1952. He gave it to me."


class FakeSocket:
    def __init__(self, *messages):
        self.inbox = list(messages)
        self.sent: list[dict] = []
        self.close_code: int | None = None

    async def accept(self):
        pass

    async def receive_json(self):
        return json.loads(self.inbox.pop(0)["text"])

    async def receive(self):
        return self.inbox.pop(0) if self.inbox else {"type": "websocket.disconnect"}

    async def send_json(self, data):
        self.sent.append(data)

    async def close(self, code=1000):
        self.close_code = code


def text(data):
    return {"type": "websocket.receive", "text": json.dumps(data)}


def audio(ms):
    return {"type": "websocket.receive", "bytes": b"\x01\x00" * (16 * ms)}


@pytest.fixture
async def answer(conn, fakes, seed, monkeypatch):
    def user_from_token(token):
        if token != "good-token":
            raise jwt.InvalidTokenError("bad")
        return User(id=seed.user_id)

    monkeypatch.setattr(answer_stream, "user_from_token", user_from_token)
    interview_id = await start_interview(conn, seed, state="listening")
    turn_id, media_id = await add_answer(conn, fakes, seed, interview_id, idx=1)
    return interview_id, turn_id, media_id


async def state_of(conn, interview_id):
    return await conn.fetchval("select state from interview where id = $1", interview_id)


async def test_streamed_answer_is_saved_timed_and_queues_the_next_question(
    conn, fakes, seed, answer
):
    interview_id, turn_id, media_id = answer
    await conn.execute(
        "insert into person (family_id, display_name) values ($1, 'Hari')", seed.family_id
    )
    fakes.asr_stream.result = StreamedTranscript(
        text=SPOKEN,
        progress=[
            ("My father Hari", 1200),
            ("My father Hari bought it in 1952.", 3100),
            (SPOKEN, 5000),
        ],
        duration_ms=5000,
    )
    ws = FakeSocket(
        text({"type": "start", "token": "good-token"}),
        audio(2500),
        audio(2500),
        text({"type": "end"}),
    )

    await answer_stream.stream_answer(ws, interview_id, turn_id)

    assert sorted(fakes.asr_stream.keywords) == ["Hari", "Nani"]
    assert ws.sent == [
        {"type": "partial", "text": "heard 1"},
        {"type": "partial", "text": "heard 2"},
        {"type": "done", "text": SPOKEN},
    ]
    assert await conn.fetchval("select text from turn where id = $1", turn_id) == SPOKEN
    segments = await conn.fetch(
        "select start_ms, end_ms, text from segment where turn_id = $1 order by start_ms", turn_id
    )
    assert [tuple(s) for s in segments] == [
        (0, 3100, "My father Hari bought it in 1952."),
        (3100, 5000, "He gave it to me."),
    ]
    assert await state_of(conn, interview_id) == "thinking"
    assert (
        await conn.fetchval(
            "select status from job where kind = 'next_question' and subject_id = $1", interview_id
        )
        == "queued"
    )
    path = await conn.fetchval("select storage_path from media where id = $1", media_id)
    with wave.open(io.BytesIO(fakes.files[path])) as w:
        assert (w.getframerate(), w.getnframes()) == (16_000, 80_000), (
            "5 s of audio kept for playback"
        )


async def test_stream_rejects_a_bad_token_or_someone_elses_answer(conn, fakes, seed, answer):
    interview_id, turn_id, _ = answer

    bad_token = FakeSocket(text({"type": "start", "token": "forged"}))
    await answer_stream.stream_answer(bad_token, interview_id, turn_id)
    wrong_interview = FakeSocket(text({"type": "start", "token": "good-token"}))
    await answer_stream.stream_answer(wrong_interview, uuid4(), turn_id)

    assert bad_token.close_code == wrong_interview.close_code == 1008
    assert fakes.asr_stream.chunks == []


async def test_stream_failure_tells_the_phone_to_upload_instead(conn, fakes, seed, answer):
    interview_id, turn_id, _ = answer
    fakes.asr_stream.fail = RuntimeError("meta dropped the session")
    ws = FakeSocket(
        text({"type": "start", "token": "good-token"}), audio(500), text({"type": "end"})
    )

    await answer_stream.stream_answer(ws, interview_id, turn_id)

    assert ws.sent[-1] == {"type": "error"} and ws.close_code == 1011
    assert await conn.fetchval("select text from turn where id = $1", turn_id) is None
    assert await state_of(conn, interview_id) == "listening", "the batch upload takes over"


def test_timed_segments_end_each_sentence_where_its_period_first_appeared():
    progress = [
        ("One", 400),
        ("One.", 900),
        ("One. Two", 1500),
        ("One. Two.", 2100),
        ("One. Two. Three.", 3000),
    ]
    segs = timed_segments(progress, "One. Two. Three.", 3200)
    assert [(s.start_ms, s.end_ms, s.text) for s in segs] == [
        (0, 900, "One."),
        (900, 2100, "Two."),
        (2100, 3200, "Three."),
    ]


def test_timed_segments_falls_back_to_estimates_when_partials_disagree():
    segs = timed_segments([("no punctuation at all", 1000)], "One. Two.", 2000)
    assert [s.text for s in segs] == ["One.", "Two."]
    assert segs[0].start_ms == 0 and segs[-1].end_ms == 2000
