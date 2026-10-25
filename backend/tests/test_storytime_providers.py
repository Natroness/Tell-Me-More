import json

import httpx
import pytest

from app.config import Settings
from app.providers.gemini_tts import GeminiTTS
from app.providers.pixabay import Pixabay
from tests.conftest import make_wav


def transport(monkeypatch, handler):
    client = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: client(transport=httpx.MockTransport(handler), **kwargs),
    )


async def test_fixed_english_narration_and_empty_key(monkeypatch):
    import base64

    seen = []

    def handler(request):
        seen.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "inlineData": {
                                        "mimeType": "audio/wav",
                                        "data": base64.b64encode(make_wav(1)).decode(),
                                    }
                                }
                            ]
                        }
                    }
                ]
            },
        )

    transport(monkeypatch, handler)
    provider = GeminiTTS(Settings(gemini_api_key="test", tts_voice="Sulafat"))
    blob = await provider.speak("She kept the watch.")
    assert blob.mime == "audio/wav" and blob.data.startswith(b"RIFF")
    assert seen[0]["generationConfig"]["speechConfig"] == {
        "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": "Sulafat"}}
    }
    assert "reference" not in str(seen)
    with pytest.raises(ValueError, match="English only"):
        await provider.speak("text", language="unsupported")
    empty = GeminiTTS(Settings(gemini_api_key=""))
    with pytest.raises(RuntimeError, match="not configured"):
        await empty.speak("She kept it.")


async def test_pixabay_cache_and_credentials_are_not_persisted(conn, monkeypatch):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(
            200,
            json={
                "hits": [
                    {
                        "id": 123,
                        "largeImageURL": "https://pixabay.com/image.jpg",
                        "imageWidth": 1920,
                        "imageHeight": 1080,
                        "user": "Artist",
                        "pageURL": "https://pixabay.com/photos/123/",
                    }
                ]
            },
        )

    transport(monkeypatch, handler)
    stock = Pixabay(Settings(pixabay_api_key="private-test-key"))
    first = await stock.search("train platform")
    assert first == await stock.search("train platform") and len(calls) == 1
    assert first[0].photographer == "Artist"
    params = await conn.fetchval("select params from serp_cache where key like 'pixabay:%'")
    assert "key" not in params and "private-test-key" not in str(params)
    await conn.execute("update serp_cache set created_at=now()-interval '25 hours'")
    await stock.search("train platform")
    assert len(calls) == 2
    assert await Pixabay(Settings(pixabay_api_key="")).search("anything") == []


async def test_stock_errors_never_expose_the_key(monkeypatch):
    transport(monkeypatch, lambda request: httpx.Response(403))
    with pytest.raises(RuntimeError) as error:
        await Pixabay(Settings(pixabay_api_key="private-test-key"), cache=False).search("watch")
    assert "private-test-key" not in str(error.value) and "403" in str(error.value)
