"""Meta Model API adapters. Chat, vision and images use the OpenAI-compatible API; speech uses
Meta's own ASR endpoint. All verified live by scripts/check_services.py."""

import asyncio
import base64
import json
import re
from collections.abc import AsyncIterator, Awaitable, Callable

import httpx
import websockets
from openai import AsyncOpenAI

from app.config import Settings
from app.providers.base import (
    Blob,
    Effort,
    Msg,
    StreamedTranscript,
    T,
    Transcript,
    TranscriptSegment,
)


def _client(s: Settings) -> AsyncOpenAI:
    return AsyncOpenAI(api_key=s.meta_api_key, base_url=s.meta_base_url or None)


class MetaLLM:
    def __init__(self, s: Settings, model: str | None = None) -> None:
        self._client = _client(s)
        self._model = model or s.meta_chat_model

    async def json(
        self,
        *,
        system: str,
        messages: list[Msg],
        schema: type[T],
        images: list[Blob] | None = None,
        effort: Effort | None = None,
    ) -> T:
        msgs: list[Msg] = [{"role": "system", "content": system}, *messages]
        if images:
            msgs.append({"role": "user", "content": [_image_part(i) for i in images]})
        extra = {"reasoning_effort": effort} if effort else {}
        resp = await self._client.chat.completions.create(
            model=self._model,
            messages=msgs,
            **extra,
            response_format={
                "type": "json_schema",
                "json_schema": {"name": schema.__name__, "schema": schema.model_json_schema()},
            },
        )
        return schema.model_validate_json(resp.choices[0].message.content or "")

    async def text(self, *, system: str, messages: list[Msg], effort: Effort | None = None) -> str:
        extra = {"reasoning_effort": effort} if effort else {}
        resp = await self._client.chat.completions.create(
            model=self._model, messages=[{"role": "system", "content": system}, *messages], **extra
        )
        return (resp.choices[0].message.content or "").strip()


def _image_part(image: Blob) -> dict:
    b64 = base64.b64encode(image.data).decode()
    return {"type": "image_url", "image_url": {"url": f"data:{image.mime};base64,{b64}"}}


# languageBias takes language names; unknown codes are left to autodetect.
_LANGUAGE_NAMES = {
    "en": "english",
    "es": "spanish",
    "hi": "hindi",
    "ne": "nepali",
    "fr": "french",
    "de": "german",
    "pt": "portuguese",
    "it": "italian",
    "zh": "chinese",
    "ja": "japanese",
    "ko": "korean",
    "ar": "arabic",
    "vi": "vietnamese",
    "tl": "tagalog",
}


class MetaASR:
    """One-shot file transcription (POST /v1/asr/transcribe), per Meta's cookbook.
    ENDPOINTING mode returns one timed turn per detected speech segment."""

    def __init__(self, s: Settings) -> None:
        self._key = s.meta_api_key
        self._url = s.meta_asr_url
        self._model = s.meta_asr_model

    async def transcribe(
        self, *, audio: Blob, language: str | None = None, keywords: list[str] | None = None
    ) -> Transcript:
        request: dict = {"mode": "ENDPOINTING", "model": self._model, "audioEncoding": "WAV"}
        if keywords:
            request["keywords"] = keywords
        if language in _LANGUAGE_NAMES:
            request["languageBias"] = [_LANGUAGE_NAMES[language]]
        async with httpx.AsyncClient(timeout=120) as http:
            r = await http.post(
                self._url,
                headers={"Authorization": f"Bearer {self._key}"},
                files={
                    "request": (None, json.dumps(request), "application/json"),
                    "audio": ("answer.wav", audio.data, audio.mime),
                },
            )
        body = r.raise_for_status().json()
        turns = [t for t in body.get("turns") or [] if t.get("transcript")]
        segments = [
            TranscriptSegment(
                start_ms=t.get("startMs") or 0,
                end_ms=t.get("endMs") or t.get("startMs") or 0,
                text=t["transcript"].strip(),
            )
            for t in turns
        ]
        text = body.get("transcript") or " ".join(s.text for s in segments)
        return Transcript(text=text.strip(), language=language, segments=segments)


class StreamError(RuntimeError):
    """The realtime session was rejected or dropped."""


_PCM_BYTES_PER_MS = 32  # 16 kHz, 16-bit mono
_DOUBLED_STOP = re.compile(r"\.{2,}(?=\s|$)")


class MetaStreamingASR:
    """Realtime transcription over Meta's WebSocket (wss://api.meta.ai/v1/asr/realtime), per the
    cookbook. PUSH_TO_TALK: we end the turn, and the final transcript follows in ~0.15 s."""

    def __init__(self, s: Settings) -> None:
        self._key = s.meta_api_key
        self._url = s.meta_asr_stream_url
        self._model = s.meta_asr_model

    async def stream(
        self,
        audio: AsyncIterator[bytes],
        *,
        language: str | None = None,
        keywords: list[str] | None = None,
        on_partial: Callable[[str], Awaitable[None]] | None = None,
    ) -> StreamedTranscript:
        handshake: dict = {
            "mode": "PUSH_TO_TALK",
            "authorization": {"accessToken": self._key},
            "audioEncoding": "PCM_16KHZ",
            "model": self._model,
            "partialMode": "CUMULATIVE",
            "emitAudioProgress": False,
        }
        if keywords:
            handshake["keywords"] = keywords
        if language in _LANGUAGE_NAMES:
            handshake["languageBias"] = [_LANGUAGE_NAMES[language]]

        sent = 0
        finals: list[str] = []
        progress: list[tuple[str, int]] = []
        async with websockets.connect(self._url, max_size=None, open_timeout=10) as ws:
            await ws.send(json.dumps(handshake))
            ack = json.loads(await ws.recv())
            if ack.get("type") == "error":
                raise StreamError(ack.get("message", "handshake rejected"))

            async def upload() -> None:
                nonlocal sent
                async for chunk in audio:
                    await ws.send(chunk)
                    sent += len(chunk)
                await ws.send(json.dumps({"type": "endStream"}))

            uploader = asyncio.create_task(upload())
            try:
                async for message in ws:
                    if isinstance(message, bytes):
                        continue
                    event = json.loads(message)
                    if event.get("type") == "error":
                        raise StreamError(event.get("message", "transcription failed"))
                    if event.get("type") != "transcript":
                        continue
                    # Partials are cumulative within an utterance; a final closes it.
                    text = " ".join([*finals, event.get("transcript", "")]).strip()
                    if event.get("final"):
                        finals.append(event.get("transcript", ""))
                    progress.append((text, event.get("audioProcessedMs") or 0))
                    if on_partial:
                        await on_partial(text)
            except websockets.ConnectionClosed as e:
                if e.code != 1000:
                    raise StreamError(f"session closed [{e.code}] {e.reason}") from e
            finally:
                uploader.cancel()
                upload_error = (await asyncio.gather(uploader, return_exceptions=True))[0]
            if isinstance(upload_error, Exception):
                raise StreamError(f"sending audio failed: {upload_error!r}") from upload_error

        text = _DOUBLED_STOP.sub(".", " ".join(f.strip() for f in finals if f.strip()))
        return StreamedTranscript(
            text=text, progress=progress, duration_ms=sent // _PCM_BYTES_PER_MS
        )


class MetaImage:
    def __init__(self, s: Settings) -> None:
        self._client = _client(s)
        self._model = s.meta_image_model

    async def generate(self, prompt: str) -> bytes:
        resp = await self._client.images.generate(
            model=self._model, prompt=prompt, response_format="b64_json"
        )
        return base64.b64decode(resp.data[0].b64_json or "")
