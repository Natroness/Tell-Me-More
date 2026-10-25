"""Stages 1-4: what a family sees between taking the photo and hearing the next question."""

from uuid import uuid4

from app.jobs.stages import analyze_object, lens_lookup, next_question, transcribe_turn
from app.jobs.stages.lens_lookup import LensFinding, LensFindings
from app.jobs.stages.transcribe_turn import estimate_segments, sentence_segments
from app.models import NextQuestion, ObjectReading, ObservedDetail
from app.providers.base import LensMatch, Transcript, TranscriptSegment
from tests.conftest import make_wav

READING = ObjectReading(
    suggested_title="Gold wedding ring",
    category="jewelry",
    details=[
        ObservedDetail(label="Engraving", detail="Inside reads 'R & S 1961'.", confidence=0.9),
        ObservedDetail(
            label="Resized", detail="A seam shows the band was resized.", confidence=0.7
        ),
    ],
    seed_questions=["Who are R and S?", "Why was the ring resized?"],
)


async def test_analyze_object_saves_details_title_and_seed_questions(conn, fakes, seed):
    fakes.llm.responses[ObjectReading] = READING

    await analyze_object.run(seed.heirloom_id)
    await analyze_object.run(seed.heirloom_id)  # retries must not duplicate facts

    facts = await conn.fetch(
        "select text, source from fact where heirloom_id = $1 order by confidence desc",
        seed.heirloom_id,
    )
    assert [f["text"] for f in facts] == [d.detail for d in READING.details]
    assert all(f["source"]["via"] == "vision" for f in facts)
    assert fakes.llm.calls[0]["images"][0].mime == "image/jpeg", "photo bytes reach the model"

    heirloom = await conn.fetchrow(
        "select title, category from heirloom where id = $1", seed.heirloom_id
    )
    assert (heirloom["title"], heirloom["category"]) == ("Gold wedding ring", "jewelry")


async def test_analyze_object_keeps_a_title_the_family_already_set(conn, fakes, seed):
    await conn.execute("update heirloom set title = 'Nani''s ring' where id = $1", seed.heirloom_id)
    fakes.llm.responses[ObjectReading] = READING

    await analyze_object.run(seed.heirloom_id)

    assert (
        await conn.fetchval("select title from heirloom where id = $1", seed.heirloom_id)
        == "Nani's ring"
    )


async def test_seed_questions_become_the_interview_opener(conn, fakes, seed):
    await conn.execute(
        "insert into job (kind, subject_id, family_id) values ('analyze_object', $1, $2)",
        seed.heirloom_id,
        seed.family_id,
    )
    fakes.llm.responses[ObjectReading] = READING

    await analyze_object.run(seed.heirloom_id)

    output = await conn.fetchval(
        "select output from job where kind = 'analyze_object' and subject_id = $1",
        seed.heirloom_id,
    )
    assert output["seed_questions"] == READING.seed_questions


async def test_lens_lookup_keeps_only_confident_findings_with_their_source_link(conn, fakes, seed):
    fakes.search.matches = [
        LensMatch(title="Vintage 1960s gold band", link="https://shop.test/band"),
        LensMatch(title="Stock photo of rings", link="https://stock.test/rings"),
    ]
    fakes.llm.responses[LensFindings] = LensFindings(
        findings=[
            LensFinding(text="Looks like a 1960s yellow gold band.", match_index=0, confidence=0.8),
            LensFinding(text="Possibly a stock design.", match_index=1, confidence=0.2),
            LensFinding(text="Out of range.", match_index=7, confidence=0.9),
        ]
    )

    await lens_lookup.run(seed.heirloom_id)

    facts = await conn.fetch(
        "select text, source from fact where heirloom_id = $1", seed.heirloom_id
    )
    assert [(f["text"], f["source"]["url"]) for f in facts] == [
        ("Looks like a 1960s yellow gold band.", "https://shop.test/band")
    ]


async def test_lens_lookup_with_no_matches_skips_the_model(conn, fakes, seed):
    await lens_lookup.run(seed.heirloom_id)

    assert fakes.llm.calls == []
    assert await conn.fetchval("select count(*) from fact") == 0


async def start_interview(conn, seed, state="thinking"):
    interview_id = uuid4()
    await conn.execute(
        "insert into interview (id, heirloom_id, narrator_id, interviewer_user_id, state) "
        "values ($1, $2, $3, $4, $5)",
        interview_id,
        seed.heirloom_id,
        seed.narrator_id,
        seed.user_id,
        state,
    )
    await conn.execute(
        "insert into turn (interview_id, idx, role, text) "
        "values ($1, 0, 'question', 'Who gave you this ring?')",
        interview_id,
    )
    return interview_id


async def add_answer(conn, fakes, seed, interview_id, idx, seconds=6.0, text=None):
    media_id, turn_id = uuid4(), uuid4()
    path = f"{seed.family_id}/{seed.heirloom_id}/{media_id}.wav"
    await conn.execute(
        "insert into media (id, family_id, heirloom_id, kind, storage_path, mime) "
        "values ($1, $2, $3, 'audio', $4, 'audio/wav')",
        media_id,
        seed.family_id,
        seed.heirloom_id,
        path,
    )
    await conn.execute(
        "insert into turn (id, interview_id, idx, role, text, audio_media_id) "
        "values ($1, $2, $3, 'answer', $4, $5)",
        turn_id,
        interview_id,
        idx,
        text,
        media_id,
    )
    fakes.files[path] = make_wav(seconds)
    return turn_id, media_id


async def test_transcribe_turn_saves_timed_segments_and_queues_the_next_question(conn, fakes, seed):
    interview_id = await start_interview(conn, seed)
    turn_id, media_id = await add_answer(conn, fakes, seed, interview_id, idx=1)
    fakes.asr.transcript = Transcript(
        text="My mother gave it to me. It was 1961.",
        segments=[
            TranscriptSegment(start_ms=0, end_ms=2500, text="My mother gave it to me."),
            TranscriptSegment(start_ms=2500, end_ms=6000, text="It was 1961."),
        ],
    )

    await transcribe_turn.run(turn_id)

    assert await conn.fetchval("select text from turn where id = $1", turn_id) == (
        "My mother gave it to me. It was 1961."
    )
    segments = await conn.fetch(
        "select start_ms, end_ms, text from segment where turn_id = $1 order by start_ms", turn_id
    )
    assert [tuple(s) for s in segments] == [
        (0, 2500, "My mother gave it to me."),
        (2500, 6000, "It was 1961."),
    ]
    assert await conn.fetchval("select duration_ms from media where id = $1", media_id) == 6000
    assert (
        await conn.fetchval(
            "select status from job where kind = 'next_question' and subject_id = $1", interview_id
        )
        == "queued"
    )


async def test_transcribe_turn_estimates_timing_when_asr_has_none(conn, fakes, seed):
    interview_id = await start_interview(conn, seed)
    turn_id, _ = await add_answer(conn, fakes, seed, interview_id, idx=1, seconds=4.0)
    fakes.asr.transcript = Transcript(text="It was my mother's. She wore it daily.", segments=[])

    await transcribe_turn.run(turn_id)
    await transcribe_turn.run(turn_id)  # retries replace, not append

    segments = await conn.fetch(
        "select start_ms, end_ms from segment where turn_id = $1 order by start_ms", turn_id
    )
    assert len(segments) == 2
    assert segments[0]["start_ms"] == 0 and segments[-1]["end_ms"] <= 4000


def test_estimate_segments_splits_by_sentence_and_spans_the_recording():
    segs = estimate_segments("Short. A much longer second sentence here!", 10_000)
    assert [s.text for s in segs] == ["Short.", "A much longer second sentence here!"]
    assert segs[0].start_ms == 0 and segs[0].end_ms == segs[1].start_ms
    assert segs[0].end_ms < segs[1].end_ms - segs[1].start_ms, "longer sentence gets more time"


def test_multi_sentence_asr_turns_are_split_within_their_time_span():
    turns = [
        TranscriptSegment(start_ms=1000, end_ms=5000, text="It was 1961. She wore it daily."),
        TranscriptSegment(start_ms=6000, end_ms=7000, text="Yes."),
    ]
    segs = sentence_segments(turns, "unused", 9000)
    assert [s.text for s in segs] == ["It was 1961.", "She wore it daily.", "Yes."]
    assert (segs[0].start_ms, segs[1].end_ms) == (1000, 5000)
    assert segs[0].end_ms == segs[1].start_ms
    assert (segs[2].start_ms, segs[2].end_ms) == (6000, 7000)


FOLLOW_UP = NextQuestion(
    updated_coverage={"origin": "filled", "moment": "partial"},
    kind="follow_up",
    target_slot="moment",
    question="What was happening in your life in 1961?",
    why="She named a year but not the moment.",
)


async def test_next_question_asks_a_follow_up_and_tracks_coverage(conn, fakes, seed):
    interview_id = await start_interview(conn, seed)
    await add_answer(
        conn, fakes, seed, interview_id, idx=1, text="My mother gave it to me in 1961."
    )
    fakes.llm.responses[NextQuestion] = FOLLOW_UP

    await next_question.run(interview_id)

    turn = await conn.fetchrow(
        "select idx, role, text, target_slot from turn where interview_id = $1 "
        "order by idx desc limit 1",
        interview_id,
    )
    assert tuple(turn) == (2, "question", FOLLOW_UP.question, "moment")
    interview = await conn.fetchrow(
        "select state, coverage from interview where id = $1", interview_id
    )
    assert interview["state"] == "asking"
    assert interview["coverage"]["origin"] == "filled"
    assert interview["coverage"]["secret"] == "open", "untouched slots stay open"

    prompt_text = fakes.llm.calls[0]["system"] + fakes.llm.calls[0]["messages"][0]["content"]
    assert "Nani" in prompt_text and "grandmother" in prompt_text
    assert "A: My mother gave it to me in 1961." in prompt_text


async def test_next_question_does_nothing_once_the_interview_is_finished(conn, fakes, seed):
    interview_id = await start_interview(conn, seed, state="wrapping_up")

    await next_question.run(interview_id)

    assert fakes.llm.calls == []
    assert (
        await conn.fetchval("select count(*) from turn where interview_id = $1", interview_id) == 1
    )


async def test_next_question_wraps_up_after_eight_answers(conn, fakes, seed):
    interview_id = await start_interview(conn, seed)
    for i in range(8):
        await add_answer(conn, fakes, seed, interview_id, idx=i + 1, text=f"answer {i}")

    await next_question.run(interview_id)

    assert fakes.llm.calls == []
    assert await conn.fetchval("select state from interview where id = $1", interview_id) == (
        "wrapping_up"
    )
    assert (
        await conn.fetchval(
            "select status from job where kind = 'extract_facts' and subject_id = $1",
            seed.heirloom_id,
        )
        == "queued"
    )
