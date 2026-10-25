from typing import Any, Literal, Protocol, TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)

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
    ) -> T: ...


class ASR(Protocol):
    async def transcribe(self, *, audio: Blob, language: str | None = None) -> Transcript: ...


class ImageGen(Protocol):
    async def generate(self, prompt: str) -> bytes: ...


class Search(Protocol):
    async def lens(self, image_url: str) -> list[LensMatch]: ...

    async def web(
        self, q: str, engine: Literal["google", "google_news"] = "google"
    ) -> list[SerpResult]: ...
