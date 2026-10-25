"""Domain shapes shared by the pipeline, the API, and the frontend (via OpenAPI). DESIGN.md §4."""

from datetime import datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import BaseModel, Field, HttpUrl, model_validator


class BBox(BaseModel):
    """Normalized 0..1 coordinates on the photo."""

    x: float
    y: float
    w: float
    h: float


# Provenance: the four kinds of truth, kept apart forever.


class MemorySource(BaseModel):
    """Said aloud in an interview (segment_ids) or written by a relative (memory_note_id)."""

    kind: Literal["memory"]
    segment_ids: list[UUID] = []
    memory_note_id: UUID | None = None
    narrator_id: UUID

    @model_validator(mode="after")
    def _one_origin(self) -> Self:
        if bool(self.segment_ids) == (self.memory_note_id is not None):
            raise ValueError("a memory cites either segments or one memory note")
        return self


class ObservationSource(BaseModel):
    kind: Literal["observation"]
    media_id: UUID
    bbox: BBox | None = None
    via: Literal["vision", "lens"]
    url: HttpUrl | None = None  # lens only: the matching web page


class HistorySource(BaseModel):
    kind: Literal["history"]
    url: HttpUrl
    title: str
    retrieved_at: datetime


class InferenceSource(BaseModel):
    kind: Literal["inference"]
    based_on: list[UUID]


Source = Annotated[
    MemorySource | ObservationSource | HistorySource | InferenceSource,
    Field(discriminator="kind"),
]

FactKind = Literal["memory", "observation", "history", "inference"]


class Fact(BaseModel):
    id: UUID
    heirloom_id: UUID
    kind: FactKind
    text: str
    source: Source
    year: int | None = None
    place: str | None = None
    people: list[UUID] = []
    confidence: float | None = None


# Story blocks. Every sentence cites at least one segment or fact.


class SegmentCite(BaseModel):
    kind: Literal["segment"]
    segment_id: UUID


class FactCite(BaseModel):
    kind: Literal["fact"]
    fact_id: UUID


Citation = Annotated[SegmentCite | FactCite, Field(discriminator="kind")]


class Sentence(BaseModel):
    text: str
    cites: list[Citation] = Field(min_length=1)


class Heading(BaseModel):
    type: Literal["heading"]
    text: str


class Paragraph(BaseModel):
    type: Literal["paragraph"]
    sentences: list[Sentence]


class Quote(BaseModel):
    """Verbatim. The text is read from the segment at render time, never stored here."""

    type: Literal["quote"]
    segment_id: UUID
    speaker_id: UUID


class Photo(BaseModel):
    type: Literal["photo"]
    media_id: UUID
    caption: Sentence | None = None


class TimelineEvent(BaseModel):
    year: int
    label: str
    fact_id: UUID


class Timeline(BaseModel):
    type: Literal["timeline"]
    events: list[TimelineEvent]


class People(BaseModel):
    type: Literal["people"]
    person_ids: list[UUID]


class Context(BaseModel):
    type: Literal["context"]
    card_ids: list[UUID]


class Memory(BaseModel):
    type: Literal["memory"]
    memory_note_id: UUID


StoryBlock = Annotated[
    Heading | Paragraph | Quote | Photo | Timeline | People | Context | Memory,
    Field(discriminator="type"),
]


class StoryDraft(BaseModel):
    """What compose_story asks the model for."""

    title: str
    dek: str
    blocks: list[StoryBlock]


# Interview.

InterviewState = Literal["ready", "asking", "listening", "thinking", "wrapping_up", "done"]

Slot = Literal[
    "origin",  # where did it come from, who first owned it
    "acquisition",  # how did you get it
    "moment",  # what was happening in your life then
    "people",  # who else is part of this story
    "sensory",  # a detail only someone who held it would know
    "secret",  # something nobody else knows
    "meaning",  # why it matters, what it stands for
    "legacy",  # who should have it next, what should they know
]
SlotStatus = Literal["open", "partial", "filled"]
Coverage = dict[Slot, SlotStatus]


class CoverageUpdate(BaseModel):
    updated_coverage: Coverage


# Object reading (stage 1 output).

HeirloomCategory = Literal[
    "jewelry", "watch", "letter", "recipe", "clothing", "toy", "photo", "other"
]


class ObservedDetail(BaseModel):
    label: str
    detail: str
    bbox: BBox | None = None
    confidence: float = Field(ge=0, le=1)


class ObjectReading(BaseModel):
    suggested_title: str
    category: HeirloomCategory
    details: list[ObservedDetail]
    # One line of what tells this exact object apart from others of its kind, kept on the
    # heirloom so later captures can be matched against it without rereading any photo.
    signature: str
    seed_questions: list[str] = Field(min_length=1, max_length=3)
