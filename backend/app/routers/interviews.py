"""Interview lifecycle. The server owns `interview.state` (DESIGN.md §5.2); the phone renders it
from Supabase Realtime."""

from uuid import UUID, uuid4

import asyncpg
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.auth import CurrentUser, User, family_of_heirloom, require_member
from app.db import pool
from app.jobs.queue import enqueue
from app.jobs.stages.next_question import MAX_QUESTIONS
from app.models import Coverage, InterviewState
from app.storage import object_path, signed_upload_url

router = APIRouter(prefix="/api/interviews", tags=["interviews"])

OPENING_QUESTION = "Tell me about this. Where did it come from?"


class Interview(BaseModel):
    id: UUID
    heirloom_id: UUID
    narrator_id: UUID
    language: str
    state: InterviewState
    coverage: Coverage
    max_questions: int = MAX_QUESTIONS


class Turn(BaseModel):
    id: UUID
    idx: int
    role: str
    text: str | None
    target_slot: str | None


class CreateInterview(BaseModel):
    heirloom_id: UUID
    narrator_id: UUID
    language: str = "en"
    request_id: UUID | None = None  # set when this interview answers a story request


class StartedInterview(BaseModel):
    interview: Interview
    first_question: Turn


class NewAnswer(BaseModel):
    audio_mime: str


class AnswerUpload(BaseModel):
    turn_id: UUID
    media_id: UUID
    upload_url: str


_INTERVIEW_COLS = "id, heirloom_id, narrator_id, language, state, coverage"


async def _load(conn: asyncpg.Connection, user: User, interview_id: UUID) -> asyncpg.Record:
    row = await conn.fetchrow(
        f"select {_INTERVIEW_COLS} from interview where id = $1", interview_id
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "interview not found")
    await require_member(conn, user, await family_of_heirloom(conn, row["heirloom_id"]))
    return row


async def _set_state(conn: asyncpg.Connection, interview_id: UUID, state: InterviewState) -> None:
    await conn.execute("update interview set state = $2 where id = $1", interview_id, state)


async def _check_request(conn: asyncpg.Connection, body: CreateInterview, me: UUID) -> None:
    """The storyteller tells, on their own phone or the listener's in person."""
    r = await conn.fetchrow(
        "select heirloom_id, listener_id, storyteller_id, status from story_request where id = $1",
        body.request_id,
    )
    if r is None or r["heirloom_id"] != body.heirloom_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "request not found")
    if body.narrator_id != r["storyteller_id"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "the storyteller tells this story")
    if me not in (r["listener_id"], r["storyteller_id"]):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not part of this request")
    if r["status"] not in ("pending", "in_progress"):
        raise HTTPException(status.HTTP_409_CONFLICT, f"request is {r['status']}")


@router.post("", status_code=status.HTTP_201_CREATED)
async def start_interview(body: CreateInterview, user: CurrentUser) -> StartedInterview:
    async with pool().acquire() as conn:
        family_id = await family_of_heirloom(conn, body.heirloom_id)
        me = await require_member(conn, user, family_id)
        if body.request_id:
            await _check_request(conn, body, me)
        reading = await conn.fetchval(
            "select output from job where kind = 'analyze_object' and subject_id = $1",
            body.heirloom_id,
        )
        seeds = (reading or {}).get("seed_questions") or [OPENING_QUESTION]
        async with conn.transaction():
            interview = await conn.fetchrow(
                "insert into interview (heirloom_id, narrator_id, interviewer_user_id, language, "
                f"request_id, state) values ($1, $2, $3, $4, $5, 'asking') "
                f"returning {_INTERVIEW_COLS}",
                body.heirloom_id,
                body.narrator_id,
                user.id,
                body.language,
                body.request_id,
            )
            if body.request_id:
                await conn.execute(
                    "update story_request set status = 'in_progress' "
                    "where id = $1 and status = 'pending'",
                    body.request_id,
                )
            turn = await conn.fetchrow(
                "insert into turn (interview_id, idx, role, text) values ($1, 0, 'question', $2) "
                "returning id, idx, role, text, target_slot",
                interview["id"],
                seeds[0],
            )
    return StartedInterview(interview=Interview(**interview), first_question=Turn(**turn))


@router.post("/{interview_id}/answers", status_code=status.HTTP_201_CREATED)
async def new_answer(interview_id: UUID, body: NewAnswer, user: CurrentUser) -> AnswerUpload:
    async with pool().acquire() as conn:
        interview = await _load(conn, user, interview_id)
        family_id = await family_of_heirloom(conn, interview["heirloom_id"])
        media_id = uuid4()
        path = object_path(family_id, interview["heirloom_id"], media_id, body.audio_mime)
        async with conn.transaction():
            await conn.execute(
                "insert into media (id, family_id, heirloom_id, kind, storage_path, mime, "
                "created_by) values ($1, $2, $3, 'audio', $4, $5, $6)",
                media_id,
                family_id,
                interview["heirloom_id"],
                path,
                body.audio_mime,
                user.id,
            )
            turn_id = await conn.fetchval(
                "insert into turn (interview_id, idx, role, audio_media_id) "
                "select $1, coalesce(max(idx), -1) + 1, 'answer', $2 from turn "
                "where interview_id = $1 returning id",
                interview_id,
                media_id,
            )
            await _set_state(conn, interview_id, "listening")
    return AnswerUpload(
        turn_id=turn_id, media_id=media_id, upload_url=await signed_upload_url("audio", path)
    )


@router.post("/{interview_id}/answers/{turn_id}/complete", status_code=status.HTTP_202_ACCEPTED)
async def answer_uploaded(interview_id: UUID, turn_id: UUID, user: CurrentUser) -> None:
    async with pool().acquire() as conn:
        interview = await _load(conn, user, interview_id)
        family_id = await family_of_heirloom(conn, interview["heirloom_id"])
        async with conn.transaction():
            await _set_state(conn, interview_id, "thinking")
            await enqueue(conn, "transcribe_turn", turn_id, family_id)


@router.post("/{interview_id}/finish", status_code=status.HTTP_202_ACCEPTED)
async def finish_interview(interview_id: UUID, user: CurrentUser) -> None:
    async with pool().acquire() as conn:
        interview = await _load(conn, user, interview_id)
        family_id = await family_of_heirloom(conn, interview["heirloom_id"])
        async with conn.transaction():
            await _set_state(conn, interview_id, "wrapping_up")
            await conn.execute("update interview set ended_at = now() where id = $1", interview_id)
            await enqueue(conn, "extract_facts", interview["heirloom_id"], family_id)


@router.get("/{interview_id}")
async def get_interview(interview_id: UUID, user: CurrentUser) -> Interview:
    async with pool().acquire() as conn:
        return Interview(**await _load(conn, user, interview_id))


@router.get("/{interview_id}/turns")
async def list_turns(interview_id: UUID, user: CurrentUser) -> list[Turn]:
    async with pool().acquire() as conn:
        await _load(conn, user, interview_id)
        rows = await conn.fetch(
            "select id, idx, role, text, target_slot from turn where interview_id = $1 "
            "order by idx",
            interview_id,
        )
    return [Turn(**r) for r in rows]
