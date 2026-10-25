from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any, Literal, Protocol, TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)

# How long a reasoning model may think. Lower is faster; None keeps the provider default.
Effort = Literal["minimal", "low", "medium", "high"]

# OpenAI chat message shape: {"role": "user" | "assistant", "content": str}
Msg = dict[str, Any]


class Blob(BaseModel):
    """Raw media passed to a model. Adapters encode it however their API wants."""

    data: bytes
    mime: str


class TranscriptSegment(BaseModel):
    start_ms: int
    end_ms: int
    text: str


class Transcript(BaseModel):
    text: str
    language: str | None = None
    segments: list[TranscriptSegment]


class StreamedTranscript(BaseModel):
    """A live session's final text, plus each cumulative partial with how much audio it covered,
    which is what app.segments.timed_segments turns into sentence timings."""

    text: str
    progress: list[tuple[str, int]]
    duration_ms: int


class LensMatch(BaseModel):
    title: str
    link: str
    source: str | None = None
    thumbnail: str | None = None


class SerpResult(BaseModel):
    title: str
    link: str
    snippet: str | None = None
    date: str | None = None


class LLM(Protocol):
    async def json(
        self,
        *,
        system: str,
        messages: list[Msg],
        schema: type[T],
        images: list[Blob] | None = None,
        effort: Effort | None = None,
    ) -> T: ...

    async def text(
        self, *, system: str, messages: list[Msg], effort: Effort | None = None
    ) -> str: ...


class ASR(Protocol):
    # keywords bias recognition toward words it would mishear, like family names.
    async def transcribe(
        self, *, audio: Blob, language: str | None = None, keywords: list[str] | None = None
    ) -> Transcript: ...


class StreamingASR(Protocol):
    # Streams raw 16 kHz mono 16-bit PCM while the person speaks. on_partial gets the growing
    # transcript; the return value arrives right after `audio` ends. Raises if the session drops.
    async def stream(
        self,
        audio: AsyncIterator[bytes],
        *,
        language: str | None = None,
        keywords: list[str] | None = None,
        on_partial: Callable[[str], Awaitable[None]] | None = None,
    ) -> StreamedTranscript: ...


class ImageGen(Protocol):
    async def generate(self, prompt: str) -> bytes: ...


class Search(Protocol):
    async def lens(self, image_url: str) -> list[LensMatch]: ...

    async def web(
        self, q: str, engine: Literal["google", "google_news"] = "google"
    ) -> list[SerpResult]: ...
