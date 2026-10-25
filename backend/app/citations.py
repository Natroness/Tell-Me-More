"""Story validation at the model boundary (DESIGN.md §5.4).

`check` returns the draft with every unsupported piece removed, plus a message per removal.
compose_story sends the messages back to the model once; whatever still fails is dropped.
"""

import re
from dataclasses import dataclass
from typing import NamedTuple
from uuid import UUID

from app.models import (
    Context,
    Heading,
    Memory,
    Paragraph,
    People,
    Photo,
    Quote,
    Sentence,
    StoryBlock,
    StoryDraft,
    Timeline,
)

_YEAR = re.compile(r"\b(1[89]\d\d|20\d\d)\b")


class KnownSegment(NamedTuple):
    text: str
    speaker_id: UUID


class KnownFact(NamedTuple):
    text: str
    year: int | None


@dataclass(frozen=True)
class Sources:
    """Everything a story about one heirloom may cite."""

    segments: dict[UUID, KnownSegment]
    facts: dict[UUID, KnownFact]
    cards: set[UUID]
    photos: set[UUID]
    notes: set[UUID]
    people: set[UUID]


def sentence_problems(s: Sentence, src: Sources) -> list[str]:
    problems, support = [], []
    for c in s.cites:
        if c.kind == "segment":
            seg = src.segments.get(c.segment_id)
            if seg is None:
                problems.append(f"cites unknown segment {c.segment_id}")
            else:
                support.append(seg.text)
        else:
            fact = src.facts.get(c.fact_id)
            if fact is None:
                problems.append(f"cites unknown fact {c.fact_id}")
            else:
                support += [fact.text, str(fact.year or "")]
    supported = " ".join(support)
    problems += [
        f"year {y} is not in any cited source" for y in _YEAR.findall(s.text) if y not in supported
    ]
    return problems


def check(draft: StoryDraft, src: Sources) -> tuple[StoryDraft, list[str]]:
    kept: list[StoryBlock] = []
    problems: list[str] = []
    said: set[str] = set()

    def keep_known(ids: list[UUID], known: set[UUID], what: str, where: str) -> list[UUID]:
        problems.extend(f"{where}: unknown {what} {i}" for i in ids if i not in known)
        return [i for i in ids if i in known]

    for n, block in enumerate(draft.blocks):
        where = f"block {n} ({block.type})"
        match block:
            case Heading():
                kept.append(block)
            case Paragraph():
                sentences = []
                for j, s in enumerate(block.sentences):
                    found = sentence_problems(s, src)
                    if (key := s.text.strip().casefold()) in said:
                        found.append("repeats an earlier sentence")
                    said.add(key)
                    problems += [f"{where} sentence {j} {s.text!r}: {p}" for p in found]
                    if not found:
                        sentences.append(s)
                if sentences:
                    kept.append(block.model_copy(update={"sentences": sentences}))
            case Quote():
                seg = src.segments.get(block.segment_id)
                if seg is None:
                    problems.append(f"{where}: unknown segment {block.segment_id}")
                else:  # the speaker comes from the recording, not the model
                    kept.append(block.model_copy(update={"speaker_id": seg.speaker_id}))
            case Photo():
                if block.media_id not in src.photos:
                    problems.append(f"{where}: unknown photo {block.media_id}")
                    continue
                if block.caption and (found := sentence_problems(block.caption, src)):
                    problems += [f"{where} caption: {p}" for p in found]
                    block = block.model_copy(update={"caption": None})
                kept.append(block)
            case Timeline():
                events = []
                for e in block.events:
                    fact = src.facts.get(e.fact_id)
                    if fact is None or fact.year != e.year:
                        problems.append(f"{where}: event {e.label!r} needs a fact from {e.year}")
                    else:
                        events.append(e)
                if events:
                    kept.append(block.model_copy(update={"events": events}))
            case People():
                if ids := keep_known(block.person_ids, src.people, "person", where):
                    kept.append(block.model_copy(update={"person_ids": ids}))
            case Context():
                if ids := keep_known(block.card_ids, src.cards, "context card", where):
                    kept.append(block.model_copy(update={"card_ids": ids}))
            case Memory():
                if keep_known([block.memory_note_id], src.notes, "memory note", where):
                    kept.append(block)

    if src.segments and not any(b.type == "quote" for b in kept):
        problems.append("the story has no quote blocks; quote the narrator at least twice")
    return draft.model_copy(update={"blocks": kept}), problems
