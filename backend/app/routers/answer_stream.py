"""Streaming answers: the phone streams mic PCM here while the narrator speaks, we relay it to
the realtime ASR, and the transcript is saved the moment they tap Done (DESIGN.md §5.3).

Protocol, phone -> server: one JSON `{"type": "start", "token": <Supabase JWT>}` (browsers can't
set WebSocket headers), then binary frames of 16 kHz mono 16-bit PCM, then `{"type": "end"}`.
Server -> phone: `{"type": "partial", "text"}` live captions, then one
`{"type": "done", "text", "question": {"id", "text", "number"} | null, "ended"}`, or
`{"type": "error"}`. On error the phone uploads its own copy through the batch path.

The next question comes back on this socket, skipping the job queue and the realtime round trip.
Its context loads while they speak, and a draft starts whenever they pause, so when they stop it
is often already written.
"""

import asyncio
import io
import json
import logging
import re
import time
import wave
from uuid import UUID

import jwt
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, status

from app import providers, storage
from app.auth import require_member, user_from_token
from app.db import pool
from app.jobs.queue import enqueue
from app.jobs.stages import next_question
from app.jobs.stages.next_question import Interview
from app.jobs.stages.transcribe_turn import answer_context, save_answer
from app.segments import timed_segments

router = APIRouter(prefix="/api/interviews", tags=["interviews"])
log = logging.getLogger(__name__)

SAMPLE_RATE = 16_000
START_TIMEOUT_S = 10
PAUSE_S = 0.6  # no new words for this long starts a draft of the next question


def pcm_to_wav(pcm: bytes) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm)
    return buf.getvalue()


def _words(text: str) -> str:
    return re.sub(r"[^\w]+", " ", text.lower()).strip()


class Draft:
    """The next question, drafted from the live transcript each time the narrator pauses. A
    draft is used only if the final transcript says the same words."""

    def __init__(self, interview: "asyncio.Task[Interview | None]", turn_id: UUID) -> None:
        self._interview = interview
        self._turn_id = turn_id
        self._timer: asyncio.TimerHandle | None = None
        self._text: str | None = None
        self._task: asyncio.Task[str | None] | None = None

    def heard(self, text: str) -> None:
        if self._timer:
            self._timer.cancel()
        self._timer = asyncio.get_running_loop().call_later(PAUSE_S, self._start, text)

    def _start(self, text: str) -> None:
        if self._text is not None and _words(self._text) == _words(text):
            return
        if self._task:
            self._task.cancel()
        self._text, self._task = text, asyncio.create_task(self._ask(text))

    async def _ask(self, text: str) -> str | None:
        iv = await self._interview
        if iv is None:
            raise LookupError("interview not found")
        return await next_question.ask(iv.answered(self._turn_id, text))

    async def question(self, final: str) -> tuple[str | None, bool]:
        """The question for this answer, and whether a draft already had it."""
        if self._timer:
            self._timer.cancel()
        if self._task and self._text is not None and _words(self._text) == _words(final):
            try:
                return await self._task, True
            except Exception:
                log.warning("draft question failed; asking again", exc_info=True)
        elif self._task:
            self._task.cancel()
        return await self._ask(final), False

    def cancel(self) -> None:
        if self._timer:
            self._timer.cancel()
        if self._task:
            self._task.cancel()


async def _load(interview_id: UUID) -> Interview | None:
    async with pool().acquire() as conn:
        return await next_question.load(conn, interview_id)


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

    interview = asyncio.create_task(_load(interview_id))
    draft = Draft(interview, turn_id)
    pcm = bytearray()
    chunks: asyncio.Queue[bytes | None] = asyncio.Queue()

    async def audio():
        while (chunk := await chunks.get()) is not None:
            yield chunk

    async def partial(text: str) -> None:
        draft.heard(text)
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
        ended_at = time.perf_counter()
        result = await asr
        heard_at = time.perf_counter()
        segments = timed_segments(result.progress, result.text, result.duration_ms)

        async def store() -> None:
            async with pool().acquire() as conn:
                await save_answer(
                    conn, turn_id, ctx, result.text, segments, result.duration_ms, queue_next=False
                )

        stored = asyncio.create_task(store())
        try:
            question, drafted = await draft.question(result.text)
            failed = False
        except Exception:
            log.exception("next question for %s failed; queueing it", interview_id)
            question, drafted, failed = None, False, True
        await stored
        iv = (await interview).answered(turn_id, result.text)
        async with pool().acquire() as conn, conn.transaction():
            if failed:
                await enqueue(conn, "next_question", interview_id, iv.family_id)
                question_id = None
            else:
                question_id = await next_question.save(conn, iv, question)
    except WebSocketDisconnect:
        asr.cancel()
        draft.cancel()
        return
    except Exception:
        asr.cancel()
        draft.cancel()
        log.exception("streaming answer %s failed; the phone falls back to upload", turn_id)
        await ws.send_json({"type": "error"})
        await ws.close(status.WS_1011_INTERNAL_ERROR)
        return

    await ws.send_json(
        {
            "type": "done",
            "text": result.text,
            "question": question_id
            and {"id": str(question_id), "text": question, "number": iv.questions_asked + 1},
            "ended": question_id is None and not failed,
        }
    )
    log.info(
        "answer %s: transcript %.0f ms, then question %.0f ms (drafted=%s)",
        turn_id,
        (heard_at - ended_at) * 1000,
        (time.perf_counter() - heard_at) * 1000,
        drafted,
    )
    await ws.close()
    # After replying: only the story page needs the recording.
    await storage.upload("audio", ctx["storage_path"], pcm_to_wav(bytes(pcm)), "audio/wav")
