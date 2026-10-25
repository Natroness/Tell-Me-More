"""Interview questions spoken in Gemini's voice, streamed as raw PCM."""

import base64
import json
from uuid import uuid4

import httpx

from app.auth import User, current_user
from app.config import Settings
from app.main import app
from app.providers.gemini_tts import GeminiTTS
from tests.conftest import make_wav
from tests.test_storytime_providers import transport


async def test_stream_strips_the_wav_header_and_sends_the_style(monkeypatch):
    header_and_first = make_wav(0.001, rate=24000)
    pcm = header_and_first[header_and_first.index(b"data") + 8 :]
    seen = []

    def handler(request):
        assert request.url.params["alt"] == "sse"
        seen.append(json.loads(request.content))
        events = [{"event_type": "step.start", "index": 0}] + [
            {"delta": {"mime_type": mime, "data": base64.b64encode(audio).decode()}}
            for mime, audio in (("audio/wav", header_and_first), ("audio/l16", b"\x05\x00"))
        ]
        body = "".join(f"event: x\ndata: {json.dumps(e)}\n\n" for e in events) + "data: [DONE]\n\n"
        return httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})

    transport(monkeypatch, handler)
    tts = GeminiTTS(Settings(gemini_api_key="k", tts_voice="Sulafat"))
    chunks = [c async for c in tts.stream("Who made this quilt?", style="friendly")]
    assert chunks == [pcm, b"\x05\x00"]
    content = seen[0]["input"][0]["content"][0]
    assert seen[0]["stream"] is True and content["text"] == "Who made this quilt?"
    assert content["annotations"] == [{"type": "speech_metadata", "style": "friendly"}]


async def test_route_streams_pcm_and_reports_provider_failure(fakes):
    app.dependency_overrides[current_user] = lambda: User(id=uuid4())
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            ok = await client.post("/api/speech", json={"text": "Who made this quilt?"})
            assert ok.status_code == 200 and ok.content == b"\x01\x00\x02\x00"
            assert ok.headers["content-type"].startswith("audio/L16;rate=24000")
            assert fakes.tts.calls == ["Who made this quilt?"]

            async def broken(text, *, style):
                raise RuntimeError("quota")
                yield b""

            fakes.tts.stream = broken
            failed = await client.post("/api/speech", json={"text": "Hello?"})
            assert failed.status_code == 502
            assert (await client.post("/api/speech", json={"text": ""})).status_code == 422
    finally:
        app.dependency_overrides.pop(current_user, None)
