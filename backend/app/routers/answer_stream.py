"""Streaming answers: the phone streams mic PCM here while the narrator speaks, we relay it to
the realtime ASR, and the transcript is saved the moment they tap Done (DESIGN.md §5.3).

Protocol, phone -> server: one JSON `{"type": "start", "token": <Supabase JWT>}` (browsers can't
set WebSocket headers), then binary frames of 16 kHz mono 16-bit PCM, then `{"type": "end"}`.
Server -> phone: `{"type": "partial", "text"}` live captions, then `{"type": "done", "text"}`
or `{"type": "error"}`. On error the phone uploads its own copy through the batch path.
"""

import asyncio
import io
import json
import logging
import wave
from uuid import UUID

import jwt
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, status

from app import providers, storage
from app.auth import require_member, user_from_token
from app.db import pool
from app.jobs.stages.transcribe_turn import answer_context, save_answer
from app.segments import timed_segments

router = APIRouter(prefix="/api/interviews", tags=["interviews"])
log = logging.getLogger(__name__)

SAMPLE_RATE = 16_000
START_TIMEOUT_S = 10


def pcm_to_wav(pcm: bytes) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm)
    return buf.getvalue()


@router.websocket("/{interview_id}/answers/{turn_id}/stream")
async def stream_answer(ws: WebSocket, interview_id: UUID, turn_id: UUID) -> None:
    await ws.accept()
    try:
        start = await asyncio.wait_for(ws.receive_json(), START_TIMEOUT_S)
        user = await asyncio.to_thread(user_from_token, start["token"])
        async with pool().acquire() as conn:
            ctx = await answer_context(conn, turn_id)
            if ctx is None or ctx["interview_id"] != interview_id:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "answer not found")
            await require_member(conn, user, ctx["family_id"])
    except (TimeoutError, KeyError, ValueError, jwt.PyJWTError, HTTPException):
        await ws.close(status.WS_1008_POLICY_VIOLATION)
        return

    pcm = bytearray()
    chunks: asyncio.Queue[bytes | None] = asyncio.Queue()

    async def audio():
        while (chunk := await chunks.get()) is not None:
            yield chunk

    async def partial(text: str) -> None:
        await ws.send_json({"type": "partial", "text": text})

    asr = asyncio.create_task(
        providers.get_providers().asr_stream.stream(
            audio(), language=ctx["language"], keywords=ctx["names"], on_partial=partial
        )
    )
    try:
        while True:
            message = await ws.receive()
            if message["type"] == "websocket.disconnect":
                raise WebSocketDisconnect(message.get("code", 1000))
            if (data := message.get("bytes")) is not None:
                pcm.extend(data)
                chunks.put_nowait(data)
            elif json.loads(message.get("text") or "{}").get("type") == "end":
                chunks.put_nowait(None)
                break
        result = await asr
        segments = timed_segments(result.progress, result.text, result.duration_ms)
        async with pool().acquire() as conn:
            await save_answer(conn, turn_id, ctx, result.text, segments, result.duration_ms)
    except WebSocketDisconnect:
        asr.cancel()
        return
    except Exception:
        asr.cancel()
        log.exception("streaming answer %s failed; the phone falls back to upload", turn_id)
        await ws.send_json({"type": "error"})
        await ws.close(status.WS_1011_INTERNAL_ERROR)
        return

    await ws.send_json({"type": "done", "text": result.text})
    await ws.close()
    # After replying: the next question is already being written, and only the story page
    # needs the recording.
    await storage.upload("audio", ctx["storage_path"], pcm_to_wav(bytes(pcm)), "audio/wav")
