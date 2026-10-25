from google import genai
from google.genai import types

from app.config import Settings
from app.providers.base import Blob, Effort, Msg, T


class GeminiLLM:
    def __init__(self, s: Settings) -> None:
        self._client = genai.Client(api_key=s.gemini_api_key)
        self._model = s.gemini_model

    async def json(
        self,
        *,
        system: str,
        messages: list[Msg],
        schema: type[T],
        images: list[Blob] | None = None,
        effort: Effort | None = None,
    ) -> T:
        contents = _contents(messages)
        if images:
            parts = [types.Part.from_bytes(data=i.data, mime_type=i.mime) for i in images]
            contents.append(types.Content(role="user", parts=parts))
        resp = await self._client.aio.models.generate_content(
            model=self._model,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system,
                response_mime_type="application/json",
                response_json_schema=schema.model_json_schema(),
                thinking_config=types.ThinkingConfig(thinking_level=effort.upper())
                if effort
                else None,
            ),
        )
        return schema.model_validate_json(resp.text or "")

    async def text(self, *, system: str, messages: list[Msg], effort: Effort | None = None) -> str:
        resp = await self._client.aio.models.generate_content(
            model=self._model,
            contents=_contents(messages),
            config=types.GenerateContentConfig(
                system_instruction=system,
                thinking_config=types.ThinkingConfig(thinking_level=effort.upper())
                if effort
                else None,
            ),
        )
        return (resp.text or "").strip()


def _contents(messages: list[Msg]) -> list[types.Content]:
    return [
        types.Content(
            role="model" if m["role"] == "assistant" else "user",
            parts=[types.Part.from_text(text=m["content"])],
        )
        for m in messages
    ]
