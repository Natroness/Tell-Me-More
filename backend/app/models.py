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


class SceneVisual(BaseModel):
    source: Literal["family_photo", "generated", "stock"]
    media_id: UUID | None = None
    prompt: str | None = Field(None, max_length=1200)
    stock_query: str | None = Field(None, max_length=100)
    motion: Literal["zoom_in", "zoom_out", "pan_left", "pan_right"] = "zoom_in"


class NarrationScene(BaseModel):
    type: Literal["narration"]
    narration: str = Field(min_length=1, max_length=320)
    cites: list[Citation] = Field(min_length=1)
    visual: SceneVisual
    caption: str | None = Field(None, max_length=40)


class VoiceScene(BaseModel):
    type: Literal["voice"]
    segment_ids: list[UUID] = Field(min_length=1, max_length=3)
    visual: SceneVisual


StorytimeScene = Annotated[NarrationScene | VoiceScene, Field(discriminator="type")]


class Storyboard(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    mood: Literal["tender", "nostalgic", "joyful", "bittersweet"]
    scenes: list[StorytimeScene] = Field(min_length=3, max_length=14)


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


# Immersive memories (docs/IMMERSIVE.md). A spot in the world plays the narrator's own words.


class Hotspot(BaseModel):
    id: str  # short slug, unique within the world
    label: str = Field(max_length=60)
    fact_ids: list[UUID] = Field(min_length=1)
    segment_ids: list[UUID] = []  # the clips to play; empty for a spot of observations only
    u: float | None = Field(None, ge=0, le=1)  # yaw on the panorama, None if not located
    v: float | None = Field(None, ge=0, le=1)  # pitch on the panorama


class HotspotPlan(BaseModel):
    label: str = Field(max_length=60)
    fact_ids: list[UUID] = Field(min_length=1)


class SceneSpec(BaseModel):
    # "image" only when the photo shows a wide or medium view of a place.
    input_mode: Literal["image", "text"]
    scene_prompt: str = Field(max_length=900)
    used_fact_ids: list[UUID] = Field(min_length=1)
    hotspots: list[HotspotPlan] = Field(min_length=1, max_length=6)
    # Searches for real photos of the place, built from the facts alone.
    place_query: str | None = Field(None, max_length=120)  # the kind of place, for Google Images
    place_name: str | None = Field(None, max_length=120)  # one named place, for Google Maps


class ReferencePicks(BaseModel):
    ranked: list[int] = Field(max_length=5)  # usable candidates, best first


class ReferenceQuality(BaseModel):
    usable: bool
    reason: str = Field(max_length=300)


class ReferencePhoto(BaseModel):
    """A web photo or generated scene illustration used to build a world.
    `path` is our private copy; web photos also credit their published source."""

    path: str
    mime: str
    url: str | None = None
    page_url: str | None = None
    title: str
    via: Literal["google_images", "google_maps", "generated"]


class SpotPosition(BaseModel):
    label: str
    u: float | None = Field(None, ge=0, le=1)
    v: float | None = Field(None, ge=0, le=1)


class SpotPositions(BaseModel):
    spots: list[SpotPosition]
