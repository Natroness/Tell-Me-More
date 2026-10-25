"""Stages 5-8: from a finished interview to a cited story page with a cover."""

from uuid import UUID, uuid4

from app.citations import KnownFact, KnownSegment, Sources, check
from app.jobs.stages import compose_story, cover_art, era_context, extract_facts
from app.jobs.stages.era_context import EraCard, EraCards, top_pairs
from app.jobs.stages.extract_facts import ExtractedFact, ExtractedFacts
from app.models import (
    Context,
    FactCite,
    Heading,
    Paragraph,
    Quote,
    SegmentCite,
    Sentence,
    StoryDraft,
    Timeline,
    TimelineEvent,
)
from app.providers.base import SerpResult
from tests.conftest import PNG
from tests.test_live_pipeline import add_answer, start_interview


async def job_status(conn, kind, subject_id):
    return await conn.fetchval(
        "select status from job where kind = $1 and subject_id = $2", kind, subject_id
    )


async def spoken(conn, fakes, seed, *sentences, state="wrapping_up"):
    """An interview whose one answer was transcribed into these sentences."""
    interview_id = await start_interview(conn, seed, state=state)
    turn_id, _ = await add_answer(conn, fakes, seed, interview_id, idx=1, text=" ".join(sentences))
    ids = []
    for i, text in enumerate(sentences):
        ids.append(
            await conn.fetchval(
                "insert into segment (turn_id, start_ms, end_ms, text) values ($1, $2, $3, $4) "
                "returning id",
                turn_id,
                i * 2000,
                (i + 1) * 2000,
                text,
            )
        )
    return interview_id, ids


async def add_fact(conn, seed, text, *, kind="memory", year=None, place=None, segment_id=None):
    source = (
        {"kind": "memory", "segment_ids": [str(segment_id)], "narrator_id": str(seed.narrator_id)}
        if kind == "memory"
        else {"kind": "observation", "media_id": str(seed.photo_id), "via": "vision"}
    )
    return await conn.fetchval(
        "insert into fact (heirloom_id, kind, text, source, year, place, confidence) "
        "values ($1, $2, $3, $4, $5, $6, 0.9) returning id",
        seed.heirloom_id,
        kind,
        text,
        source,
        year,
        place,
    )


# Stage 5 ------------------------------------------------------------------------------------


async def test_extract_facts_cites_what_was_said_or_written_and_drops_the_rest(conn, fakes, seed):
    _, (s1, s2) = await spoken(
        conn, fakes, seed, "Raj gave me this ring in 1961.", "We married in Kathmandu."
    )
    raj = await conn.fetchval(
        "insert into person (family_id, display_name) values ($1, 'Raj') returning id",
        seed.family_id,
    )
    note_id = await conn.fetchval(
        "insert into memory_note (heirloom_id, author_id, text) "
        "values ($1, $2, 'She never took it off.') returning id",
        seed.heirloom_id,
        seed.narrator_id,
    )
    fakes.llm.responses[ExtractedFacts] = ExtractedFacts(
        facts=[
            ExtractedFact(
                text="Raj gave Nani the ring in 1961, and they married in Kathmandu.",
                refs=["S1", "S2"],
                year=1961,
                place="Kathmandu",
                people=["raj", "Someone Unknown"],
            ),
            ExtractedFact(text="Nani never took the ring off.", refs=["N1"]),
            ExtractedFact(text="Made up.", refs=["S9"]),
        ]
    )

    await extract_facts.run(seed.heirloom_id)
    await extract_facts.run(seed.heirloom_id)  # retries replace, not append

    prompt_lines = fakes.llm.calls[0]["messages"][0]["content"].splitlines()
    assert prompt_lines == [
        "[S1] Nani: Raj gave me this ring in 1961.",
        "[S2] Nani: We married in Kathmandu.",
        "[N1] Nani wrote: She never took it off.",
    ]
    facts = await conn.fetch(
        "select text, source, year, place, people from fact where heirloom_id = $1 "
        "and kind = 'memory' order by year nulls last",
        seed.heirloom_id,
    )
    assert [f["text"] for f in facts] == [
        "Raj gave Nani the ring in 1961, and they married in Kathmandu.",
        "Nani never took the ring off.",
    ]
    spoken_fact, written_fact = facts
    assert spoken_fact["source"]["segment_ids"] == [str(s1), str(s2)]
    assert (spoken_fact["year"], spoken_fact["place"], spoken_fact["people"]) == (
        1961,
        "Kathmandu",
        [raj],
    )
    assert written_fact["source"]["memory_note_id"] == str(note_id)
    assert await job_status(conn, "era_context", seed.heirloom_id) == "queued"


async def test_extract_facts_with_nothing_said_still_moves_the_pipeline_on(conn, fakes, seed):
    await extract_facts.run(seed.heirloom_id)

    assert fakes.llm.calls == []
    assert await job_status(conn, "era_context", seed.heirloom_id) == "queued"


# Stage 6 ------------------------------------------------------------------------------------


def test_top_pairs_ranks_by_mentions_and_prefers_a_named_place():
    pairs = [(1975, None), (1961, "Kathmandu"), (1961, "Kathmandu"), (1980, "Delhi"), (1961, None)]
    assert top_pairs(pairs) == [(1961, "Kathmandu"), (1980, "Delhi"), (1961, None)]


async def test_era_context_writes_only_cards_with_real_sources(conn, fakes, seed):
    await add_fact(conn, seed, "They married in Kathmandu in 1961.", year=1961, place="Kathmandu")
    await add_fact(conn, seed, "A fact from the far past.", year=1700)
    fakes.search.results = [
        SerpResult(
            title="Nepal in 1961", link="https://news.test/1961", snippet="King Mahendra..."
        ),
    ]
    fakes.llm.responses[EraCards] = EraCards(
        cards=[
            EraCard(topic="events", summary="Nepal was changing fast.", source_indices=[0, 0]),
            EraCard(topic="music", summary="No source for this.", source_indices=[9]),
        ]
    )

    await era_context.run(seed.heirloom_id)
    await era_context.run(seed.heirloom_id)

    assert "1961 Kathmandu events news" in fakes.search.queries
    assert not any("1700" in q for q in fakes.search.queries), "implausible years are skipped"
    cards = await conn.fetch(
        "select year, place, topic, summary, sources from context_card where heirloom_id = $1",
        seed.heirloom_id,
    )
    assert [(c["year"], c["place"], c["topic"]) for c in cards] == [(1961, "Kathmandu", "events")]
    assert [s["url"] for s in cards[0]["sources"]] == ["https://news.test/1961"]
    assert await job_status(conn, "compose_story", seed.heirloom_id) == "queued"


# Stage 7: the validator ---------------------------------------------------------------------


def sources(**overrides) -> Sources:
    base = dict(segments={}, facts={}, cards=set(), photos=set(), notes=set(), people=set())
    return Sources(**{**base, **overrides})


def test_check_drops_sentences_with_unknown_cites_or_unsupported_years():
    seg, fact, speaker = uuid4(), uuid4(), uuid4()
    src = sources(
        segments={seg: KnownSegment("It was 1961 when I got it.", speaker)},
        facts={fact: KnownFact("The ring is gold.", None)},
    )
    draft = StoryDraft(
        title="The ring",
        dek="A ring.",
        blocks=[
            Paragraph(
                type="paragraph",
                sentences=[
                    Sentence(
                        text="She got it in 1961.",
                        cites=[SegmentCite(kind="segment", segment_id=seg)],
                    ),
                    Sentence(text="It is gold.", cites=[FactCite(kind="fact", fact_id=fact)]),
                    Sentence(
                        text="It was made in 1920.", cites=[FactCite(kind="fact", fact_id=fact)]
                    ),
                    Sentence(text="Invented.", cites=[FactCite(kind="fact", fact_id=uuid4())]),
                ],
            ),
            Paragraph(
                type="paragraph",
                sentences=[
                    Sentence(text="Gone.", cites=[SegmentCite(kind="segment", segment_id=uuid4())]),
                    Sentence(text="it is gold. ", cites=[FactCite(kind="fact", fact_id=fact)]),
                ],
            ),
        ],
    )

    story, problems = check(draft, src)

    assert [[s.text for s in b.sentences] for b in story.blocks] == [
        ["She got it in 1961.", "It is gold."]
    ], "an emptied paragraph disappears"
    assert len(problems) == 5
    assert any("year 1920" in p for p in problems)
    assert any("repeats an earlier sentence" in p for p in problems)
    assert any("no quote blocks" in p for p in problems)


def test_check_trusts_the_recording_for_quote_speakers_and_filters_ids():
    seg, speaker, card, fact = uuid4(), uuid4(), uuid4(), uuid4()
    src = sources(
        segments={seg: KnownSegment("I wore it every day.", speaker)},
        facts={fact: KnownFact("They married.", 1961)},
        cards={card},
    )
    draft = StoryDraft(
        title="t",
        dek="d",
        blocks=[
            Heading(type="heading", text="1961"),
            Quote(type="quote", segment_id=seg, speaker_id=uuid4()),
            Quote(type="quote", segment_id=uuid4(), speaker_id=speaker),
            Context(type="context", card_ids=[card, uuid4()]),
            Timeline(
                type="timeline",
                events=[
                    TimelineEvent(year=1961, label="Married", fact_id=fact),
                    TimelineEvent(year=1962, label="Wrong year", fact_id=fact),
                ],
            ),
        ],
    )

    story, problems = check(draft, src)

    heading, quote, context, timeline = story.blocks
    assert quote.speaker_id == speaker
    assert context.card_ids == [card]
    assert [e.label for e in timeline.events] == ["Married"]
    assert len(problems) == 3


# Stage 7: composing -------------------------------------------------------------------------


def story_citing(segment_id: UUID, fact_id: UUID, speaker: UUID) -> StoryDraft:
    return StoryDraft(
        title="Nani's ring",
        dek="A ring from 1961.",
        blocks=[
            Paragraph(
                type="paragraph",
                sentences=[
                    Sentence(
                        text="Raj gave Nani the ring in 1961.",
                        cites=[FactCite(kind="fact", fact_id=fact_id)],
                    )
                ],
            ),
            Quote(type="quote", segment_id=segment_id, speaker_id=speaker),
        ],
    )


async def test_compose_story_retries_with_the_problems_then_saves_a_version(conn, fakes, seed):
    interview_id, (seg,) = await spoken(conn, fakes, seed, "Raj gave it to me in 1961.")
    fact = await add_fact(conn, seed, "Raj gave Nani the ring in 1961.", year=1961, segment_id=seg)
    bad = story_citing(seg, uuid4(), seed.narrator_id)
    good = story_citing(seg, fact, uuid4())
    fakes.llm.responses[StoryDraft] = [bad, good]

    await compose_story.run(seed.heirloom_id)

    retry = fakes.llm.calls[1]["messages"]
    assert "unknown fact" in retry[-1]["content"], "the model hears what was wrong"
    story = await conn.fetchrow(
        "select version, title, blocks from story where heirloom_id = $1", seed.heirloom_id
    )
    assert (story["version"], story["title"]) == (1, "Nani's ring")
    assert story["blocks"][1]["speaker_id"] == str(seed.narrator_id)
    assert await conn.fetchval("select state from interview where id = $1", interview_id) == "done"
    assert await job_status(conn, "cover_art", seed.heirloom_id) == "queued"


async def test_compose_story_drops_what_still_fails_and_only_first_version_gets_art(
    conn, fakes, seed
):
    _, (seg,) = await spoken(conn, fakes, seed, "Raj gave it to me in 1961.")
    bad = story_citing(seg, uuid4(), seed.narrator_id)
    fakes.llm.responses[StoryDraft] = bad

    await compose_story.run(seed.heirloom_id)
    await conn.execute("update job set status = 'done' where kind = 'cover_art'")
    await compose_story.run(seed.heirloom_id)

    versions = await conn.fetch(
        "select version, blocks from story where heirloom_id = $1 order by version",
        seed.heirloom_id,
    )
    assert [v["version"] for v in versions] == [1, 2]
    assert [b["type"] for b in versions[-1]["blocks"]] == ["quote"], "bad paragraph dropped"
    assert await job_status(conn, "cover_art", seed.heirloom_id) == "done"


async def test_compose_story_refuses_without_any_memories(conn, fakes, seed):
    try:
        await compose_story.run(seed.heirloom_id)
    except LookupError:
        pass
    else:
        raise AssertionError("expected LookupError")
    assert fakes.llm.calls == []


# Stage 8 ------------------------------------------------------------------------------------


async def test_cover_art_saves_one_generated_image_from_the_story_and_photo(conn, fakes, seed):
    await add_fact(conn, seed, "Inside reads 'R & S 1961'.", kind="observation")
    await conn.execute(
        "insert into story (heirloom_id, version, title, blocks) "
        "values ($1, 1, 'Nani''s ring', '[]')",
        seed.heirloom_id,
    )

    await cover_art.run(seed.heirloom_id)
    await cover_art.run(seed.heirloom_id)

    assert "Nani's ring" in fakes.image.prompts[0] and "R & S 1961" in fakes.image.prompts[0]
    media = await conn.fetch(
        "select storage_path, mime from media where heirloom_id = $1 and kind = 'generated_image'",
        seed.heirloom_id,
    )
    assert len(media) == 1
    assert media[0]["mime"] == "image/png"
    assert media[0]["storage_path"].startswith(f"{seed.family_id}/{seed.heirloom_id}/")
    assert fakes.files[media[0]["storage_path"]] == PNG
