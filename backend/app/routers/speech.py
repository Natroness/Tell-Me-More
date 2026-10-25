"""Interview questions read aloud in a natural voice. The phone falls back to its own voice when
this fails, so errors before the first audio are reported, never papered over."""

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app import providers
from app.auth import CurrentUser
from app.providers.gemini_tts import PCM_RATE

router = APIRouter(prefix="/api", tags=["speech"])

INTERVIEWER = (
    "A warm, friendly interviewer chatting with an older relative: relaxed, kind, genuinely "
    "curious, unhurried, smiling as they ask"
)
MIME = f"audio/L16;rate={PCM_RATE};channels=1"


class SpeechIn(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


@router.post(
    "/speech",
    response_class=StreamingResponse,
    responses={200: {"content": {MIME: {}}, "description": "Raw 16-bit little-endian PCM"}},
)
async def speak(body: SpeechIn, _: CurrentUser) -> StreamingResponse:
    chunks = providers.get_providers().tts.stream(body.text, style=INTERVIEWER)
    # Wait for the first chunk so a provider failure is an HTTP error, not a silent empty stream.
    try:
        first = await anext(chunks)
    except Exception as e:
        await chunks.aclose()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "speech is unavailable") from e

    async def rest():
        yield first
        async for chunk in chunks:
            yield chunk

    return StreamingResponse(rest(), media_type=MIME, headers={"Cache-Control": "no-store"})
