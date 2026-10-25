"""Meta Model API adapters. Chat, vision and images use the OpenAI-compatible API; speech uses
Meta's own ASR endpoint. All verified live by scripts/check_services.py."""

import base64
import json

import httpx
from openai import AsyncOpenAI

from app.config import Settings
from app.providers.base import Blob, Msg, T, Transcript, TranscriptSegment


def _client(s: Settings) -> AsyncOpenAI:
    return AsyncOpenAI(api_key=s.meta_api_key, base_url=s.meta_base_url or None)


class MetaLLM:
    def __init__(self, s: Settings) -> None:
        self._client = _client(s)
        self._model = s.meta_chat_model

    async def json(
        self,
        *,
        system: str,
        messages: list[Msg],
        schema: type[T],
        images: list[Blob] | None = None,
    ) -> T:
        msgs: list[Msg] = [{"role": "system", "content": system}, *messages]
        if images:
            msgs.append({"role": "user", "content": [_image_part(i) for i in images]})
        resp = await self._client.chat.completions.create(
            model=self._model,
            messages=msgs,
            response_format={
                "type": "json_schema",
                "json_schema": {"name": schema.__name__, "schema": schema.model_json_schema()},
            },
        )
        return schema.model_validate_json(resp.choices[0].message.content or "")


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

    async def transcribe(self, *, audio: Blob, language: str | None = None) -> Transcript:
        request: dict = {"mode": "ENDPOINTING", "model": self._model, "audioEncoding": "WAV"}
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


class MetaImage:
    def __init__(self, s: Settings) -> None:
        self._client = _client(s)
        self._model = s.meta_image_model

    async def generate(self, prompt: str) -> bytes:
        resp = await self._client.images.generate(
            model=self._model, prompt=prompt, response_format="b64_json"
        )
        return base64.b64decode(resp.data[0].b64_json or "")
