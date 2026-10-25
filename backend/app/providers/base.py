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


class TTS(Protocol):
    async def speak(self, text: str, *, language: Literal["en"] = "en") -> Blob: ...

    def stream(self, text: str, *, style: str) -> AsyncIterator[bytes]:
        """Raw 16-bit mono PCM chunks, as soon as each is made."""
        ...


class StockPhoto(BaseModel):
    url: str
    width: int
    height: int
    photographer: str
    page_url: str
    provider: str = "Pixabay"
    asset_id: str = ""
    tags: str = ""
    license_url: str = "https://pixabay.com/service/license-summary/"


class StockImages(Protocol):
    async def search(self, query: str, *, orientation: str = "landscape") -> list[StockPhoto]: ...


class ImageResult(BaseModel):
    """A photo found on the web. `url` is the full-size file; `page_url` is where it was
    published, kept to credit it."""

    url: str
    page_url: str
    title: str = ""
    width: int | None = None
    via: Literal["google_images", "google_maps"]


class Search(Protocol):
    async def lens(self, image_url: str) -> list[LensMatch]: ...

    async def web(
        self, q: str, engine: Literal["google", "google_news"] = "google"
    ) -> list[SerpResult]: ...

    async def images(self, q: str) -> list[ImageResult]: ...

    # Photos taken inside one named place on Google Maps; empty if Maps finds no such place.
    async def place_photos(self, place: str) -> list[ImageResult]: ...


class WorldAssets(BaseModel):
    """A generated walkable world. URLs are the provider's; copy the files before relying on
    them."""

    world_id: str
    spz_urls: dict[str, str]  # "100k", "500k", "full_res"
    pano_url: str | None
    thumbnail_url: str | None
    collider_mesh_url: str | None
    caption: str | None
    metric_scale_factor: float | None
    ground_plane_offset: float | None


class WorldOp(BaseModel):
    operation_id: str
    done: bool
    error: str | None = None
    result: WorldAssets | None = None


class RateLimited(Exception):
    """The provider refused the request for now; nothing was started or charged."""

    def __init__(self, retry_after: float) -> None:
        super().__init__(f"rate limited, retry after {retry_after:.0f} s")
        self.retry_after = retry_after


class WorldGen(Protocol):
    async def start(self, *, prompt: str, image: Blob | None, display_name: str) -> str:
        """Starts a world and returns its operation id."""
        ...

    async def poll(self, operation_id: str) -> WorldOp: ...

    async def fetch(self, url: str) -> bytes: ...
