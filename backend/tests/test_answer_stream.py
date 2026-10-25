"""Streaming answers: the transcript is saved the moment the narrator stops, and the next question
comes back on the same socket."""

import asyncio
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
        if self.inbox and "pause" in self.inbox[0]:
            await asyncio.sleep(self.inbox.pop(0)["pause"])
        return self.inbox.pop(0) if self.inbox else {"type": "websocket.disconnect"}

    async def send_json(self, data):
        self.sent.append(data)

    async def close(self, code=1000):
        self.close_code = code


def text(data):
    return {"type": "websocket.receive", "text": json.dumps(data)}


def audio(ms):
    return {"type": "websocket.receive", "bytes": b"\x01\x00" * (16 * ms)}


def pause(s):
    """The narrator stops talking for s seconds before the next audio frame."""
    return {"pause": s}


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


async def test_streamed_answer_is_saved_timed_and_the_next_question_comes_straight_back(
    conn, fakes, seed, answer
):
    interview_id, turn_id, media_id = answer
    fakes.llm.responses[str] = "Where did Hari buy it?"
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
    question_id = await conn.fetchval(
        "select id from turn where interview_id = $1 and role = 'question' and idx = 2",
        interview_id,
    )
    assert ws.sent == [
        {"type": "partial", "text": "heard 1"},
        {"type": "partial", "text": "heard 2"},
        {
            "type": "done",
            "text": SPOKEN,
            "question": {"id": str(question_id), "text": "Where did Hari buy it?", "number": 2},
            "ended": False,
        },
    ]
    assert "A: " + SPOKEN in fakes.llm.calls[0]["messages"][0]["content"]
    assert await conn.fetchval("select text from turn where id = $1", turn_id) == SPOKEN
    segments = await conn.fetch(
        "select start_ms, end_ms, text from segment where turn_id = $1 order by start_ms", turn_id
    )
    assert [tuple(s) for s in segments] == [
        (0, 3100, "My father Hari bought it in 1952."),
        (3100, 5000, "He gave it to me."),
    ]
    assert await state_of(conn, interview_id) == "asking"
    assert await conn.fetchval("select count(*) from job where kind = 'next_question'") == 0, (
        "no trip through the job queue"
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


def spoken(text):
    return StreamedTranscript(text=text, progress=[(text, 2000)], duration_ms=2000)


@pytest.fixture
def quick_pause(monkeypatch):
    monkeypatch.setattr(answer_stream, "PAUSE_S", 0.05)


async def test_a_pause_drafts_the_question_so_it_is_ready_when_they_stop(
    conn, fakes, seed, answer, quick_pause
):
    interview_id, turn_id, _ = answer
    fakes.asr_stream.partials = ["My father Hari bought it.", "My father Hari bought it."]
    fakes.asr_stream.result = spoken("My father, Hari, bought it!")
    fakes.llm.responses[str] = ["Where did he buy it?"]
    ws = FakeSocket(
        text({"type": "start", "token": "good-token"}),
        audio(1000),
        pause(0.2),
        audio(200),
        text({"type": "end"}),
    )

    await answer_stream.stream_answer(ws, interview_id, turn_id)

    assert len(fakes.llm.calls) == 1, "the draft from the pause was used, not asked again"
    assert "A: My father Hari bought it." in fakes.llm.calls[0]["messages"][0]["content"], (
        "asked while they paused, before the final transcript"
    )
    assert ws.sent[-1]["question"]["text"] == "Where did he buy it?"


async def test_a_draft_is_dropped_when_they_kept_talking(conn, fakes, seed, answer, quick_pause):
    interview_id, turn_id, _ = answer
    fakes.asr_stream.partials = ["My father Hari", "My father Hari bought it in 1952."]
    fakes.asr_stream.result = spoken("My father Hari bought it in 1952.")
    fakes.llm.responses[str] = ["Who is Hari?", "What happened in 1952?"]
    ws = FakeSocket(
        text({"type": "start", "token": "good-token"}),
        audio(1000),
        pause(0.2),
        audio(1000),
        text({"type": "end"}),
    )

    await answer_stream.stream_answer(ws, interview_id, turn_id)

    assert ws.sent[-1]["question"]["text"] == "What happened in 1952?"
    assert "bought it in 1952" in fakes.llm.calls[-1]["messages"][0]["content"]


async def test_the_tenth_answer_ends_the_interview(conn, fakes, seed, answer):
    interview_id, turn_id, _ = answer
    for n in range(1, 10):
        await conn.execute(
            "insert into turn (interview_id, idx, role, text) values ($1, $2, 'question', 'q')",
            interview_id,
            100 + n,
        )
    fakes.asr_stream.result = spoken("That's everything.")
    ws = FakeSocket(
        text({"type": "start", "token": "good-token"}), audio(500), text({"type": "end"})
    )

    await answer_stream.stream_answer(ws, interview_id, turn_id)

    assert (ws.sent[-1]["question"], ws.sent[-1]["ended"]) == (None, True)
    assert fakes.llm.calls == []
    assert await state_of(conn, interview_id) == "wrapping_up"


async def test_if_the_model_fails_the_queue_asks_instead(conn, fakes, seed, answer):
    interview_id, turn_id, _ = answer  # no model response queued: the call raises
    fakes.asr_stream.result = spoken("It was my mother's.")
    ws = FakeSocket(
        text({"type": "start", "token": "good-token"}), audio(500), text({"type": "end"})
    )

    await answer_stream.stream_answer(ws, interview_id, turn_id)

    assert (ws.sent[-1]["question"], ws.sent[-1]["ended"]) == (None, False)
    assert await conn.fetchval("select text from turn where id = $1", turn_id) == (
        "It was my mother's."
    )
    assert await state_of(conn, interview_id) == "thinking"
    assert (
        await conn.fetchval(
            "select status from job where kind = 'next_question' and subject_id = $1", interview_id
        )
        == "queued"
    )


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
