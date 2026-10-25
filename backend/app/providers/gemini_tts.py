"""A fixed English narrator. No reference audio, voice cloning, or family-specific voices."""

import asyncio
import base64
import io
import json
import wave
from collections.abc import AsyncIterator
from typing import Literal

import httpx

from app.config import Settings
from app.providers.base import Blob

URL = "https://generativelanguage.googleapis.com/v1beta/interactions"
NARRATION = "Warm English narration, natural conversational pace, clear and gentle"
# Gemini speech is always 16-bit mono at this rate.
PCM_RATE = 24000


class GeminiTTS:
    def __init__(self, s: Settings) -> None:
        self._key = s.gemini_api_key
        self._model = s.tts_model
        self._voice = s.tts_voice

    @property
    def cache_key(self) -> str:
        # Invalidate audio produced by the old adapter, which spoke the style prompt.
        return f"verbatim-v2:{self._model}:{self._voice}"

    def _body(self, text: str, style: str) -> dict:
        return {
            "model": self._model,
            "store": False,
            "input": [
                {
                    "type": "user_input",
                    "content": [
                        {
                            "type": "text",
                            "text": text,
                            "annotations": [{"type": "speech_metadata", "style": style}],
                        }
                    ],
                }
            ],
            "response_format": {"type": "audio", "mime_type": "audio/wav"},
            "generation_config": {"speech_config": [{"voice": self._voice}]},
        }

    async def stream(self, text: str, *, style: str) -> AsyncIterator[bytes]:
        """Yields raw PCM (16-bit mono at `PCM_RATE`) as Gemini makes it, ~0.8s to the first
        chunk instead of ~3s for the whole clip."""
        if not self._key:
            raise RuntimeError("Gemini speech is not configured")
        body = {**self._body(text, style), "stream": True}
        async with (
            httpx.AsyncClient(timeout=30) as http,
            http.stream(
                "POST", f"{URL}?alt=sse", headers={"x-goog-api-key": self._key}, json=body
            ) as r,
        ):
            if r.is_error:
                raise RuntimeError(f"Gemini speech failed (HTTP {r.status_code})")
            async for line in r.aiter_lines():
                if not line.startswith("data:") or line == "data: [DONE]":
                    continue
                delta = json.loads(line[5:]).get("delta") or {}
                if not delta.get("data"):
                    continue
                audio = base64.b64decode(delta["data"])
                # The first delta is a WAV header plus the opening samples.
                if audio.startswith(b"RIFF"):
                    if int.from_bytes(audio[24:28], "little") != PCM_RATE:
                        raise RuntimeError("Gemini returned an unexpected sample rate")
                    audio = audio[audio.index(b"data") + 8 :]
                if audio:
                    yield audio

    async def speak(self, text: str, *, language: Literal["en"] = "en") -> Blob:
        if language != "en":
            raise ValueError("Storytime supports English only")
        if not self._key:
            raise RuntimeError("Gemini narration is not configured")
        body = self._body(text, NARRATION)
        async with httpx.AsyncClient(timeout=90) as http:
            for attempt in range(6):
                r = await http.post(URL, headers={"x-goog-api-key": self._key}, json=body)
                if r.status_code != 429 or attempt == 5:
                    break
                await asyncio.sleep(min(60, float(r.headers.get("Retry-After", 2**attempt))))
        if r.is_error:
            raise RuntimeError(f"Gemini narration failed (HTTP {r.status_code})")
        # Interactions' output_audio is the last model audio block, not user input.
        for step in reversed(r.json().get("steps", [])):
            if step.get("type") != "model_output":
                continue
            for data in reversed(step.get("content", [])):
                if data.get("type") != "audio" or not data.get("data"):
                    continue
                audio = base64.b64decode(data["data"])
                if audio.startswith(b"RIFF"):
                    return Blob(data=audio, mime="audio/wav")
                mime = data.get("mime_type", "").lower()
                if "pcm" not in mime and "l16" not in mime:
                    raise RuntimeError("Gemini returned an unsupported audio format")
                rate = next(
                    (
                        int(p.split("=", 1)[1])
                        for p in mime.split(";")
                        if p.strip().startswith("rate=")
                    ),
                    24000,
                )
                out = io.BytesIO()
                with wave.open(out, "wb") as wav:
                    wav.setnchannels(1)
                    wav.setsampwidth(2)
                    wav.setframerate(rate)
                    wav.writeframes(audio)
                return Blob(data=out.getvalue(), mime="audio/wav")
        raise RuntimeError("Gemini returned no narration audio")
