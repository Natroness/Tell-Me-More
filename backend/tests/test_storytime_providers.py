import base64
import io
import json
import wave

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
        assert request.url.path == "/v1beta/interactions"
        seen.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "steps": [
                    {
                        "type": "model_output",
                        "content": [
                            {
                                "type": "audio",
                                "mime_type": "audio/wav",
                                "data": base64.b64encode(make_wav(1)).decode(),
                            }
                        ],
                    }
                ]
            },
        )

    transport(monkeypatch, handler)
    provider = GeminiTTS(Settings(gemini_api_key="test", tts_voice="Sulafat"))
    blob = await provider.speak("She kept the watch.")
    assert blob.mime == "audio/wav" and blob.data.startswith(b"RIFF")
    assert seen[0]["generation_config"]["speech_config"] == [{"voice": "Sulafat"}]
    assert seen[0]["store"] is False
    content = seen[0]["input"][0]["content"][0]
    assert content["text"] == "She kept the watch."
    assert content["annotations"][0]["type"] == "speech_metadata"
    assert "Warm English narration" in content["annotations"][0]["style"]
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
                        "tags": "railway, train, platform",
                    }
                ]
            },
        )

    transport(monkeypatch, handler)
    stock = Pixabay(Settings(pixabay_api_key="private-test-key"))
    first = await stock.search("train platform")
    assert first == await stock.search("train platform") and len(calls) == 1
    assert first[0].photographer == "Artist"
    assert first[0].tags == "railway, train, platform"
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


async def test_tts_selects_last_model_audio_and_wraps_pcm(monkeypatch):
    pcm = b"\0\0" * 24000
    transport(
        monkeypatch,
        lambda request: httpx.Response(
            200,
            json={
                "steps": [
                    {"type": "user_input", "content": [{"type": "audio", "data": "ignored"}]},
                    {
                        "type": "model_output",
                        "content": [
                            {"type": "text", "text": "ignored"},
                            {
                                "type": "audio",
                                "mime_type": "audio/l16;rate=24000",
                                "data": base64.b64encode(pcm).decode(),
                            },
                        ],
                    },
                ]
            },
        ),
    )
    blob = await GeminiTTS(Settings(gemini_api_key="test")).speak("She kept the watch.")
    with wave.open(io.BytesIO(blob.data)) as wav:
        assert wav.getframerate() == 24000
        assert wav.getnframes() == 24000


async def test_tts_rate_limit_retries_are_bounded_and_keep_verbatim_text(monkeypatch):
    requests, waits = [], []

    def handler(request):
        requests.append(json.loads(request.content))
        return httpx.Response(429, headers={"Retry-After": "1"})

    async def sleep(delay):
        waits.append(delay)

    transport(monkeypatch, handler)
    monkeypatch.setattr("app.providers.gemini_tts.asyncio.sleep", sleep)
    with pytest.raises(RuntimeError, match="429"):
        await GeminiTTS(Settings(gemini_api_key="private-test-key")).speak("She kept the watch.")
    assert len(requests) == 6 and waits == [1] * 5
    assert all(r["input"][0]["content"][0]["text"] == "She kept the watch." for r in requests)
