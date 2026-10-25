"""Stage 4. Interview turns + coverage -> next question turn. Subject is the interview id."""

import json
from typing import get_args
from uuid import UUID

import asyncpg

from app import providers
from app.db import pool
from app.jobs.queue import enqueue
from app.models import Coverage, NextQuestion, Slot
from app.prompts import prompt

MAX_ANSWERS = 8
HISTORY_TURNS = 8  # last 4 question/answer pairs keep the prompt small and the reply fast


async def run(interview_id: UUID) -> None:
    async with pool().acquire() as conn:
        ctx = await conn.fetchrow(
            """
            select i.state, i.coverage, i.language, i.heirloom_id, h.family_id, h.title,
                   h.category, p.display_name, p.relation_label
            from interview i
            join heirloom h on h.id = i.heirloom_id
            join person p on p.id = i.narrator_id
            where i.id = $1
            """,
            interview_id,
        )
        if ctx is None or ctx["state"] != "thinking":
            return
        turns = await conn.fetch(
            "select role, text from turn where interview_id = $1 order by idx", interview_id
        )
        observations = await conn.fetch(
            "select text from fact where heirloom_id = $1 and kind = 'observation' "
            "order by confidence desc nulls last limit 8",
            ctx["heirloom_id"],
        )

    if sum(t["role"] == "answer" for t in turns) >= MAX_ANSWERS:
        async with pool().acquire() as conn, conn.transaction():
            await _wrap_up(conn, interview_id, ctx)
        return

    coverage: Coverage = {slot: ctx["coverage"].get(slot, "open") for slot in get_args(Slot)}
    object_name = ctx["title"] or ctx["category"] or "a family heirloom"
    context = _context(object_name, observations, coverage, turns)
    nq = await providers.get_providers().llm.json(
        system=prompt(
            "next_question",
            narrator=ctx["display_name"],
            relation=ctx["relation_label"] or "a family member",
            object=object_name,
            language=ctx["language"],
        ),
        messages=[{"role": "user", "content": context}],
        schema=NextQuestion,
    )

    async with pool().acquire() as conn, conn.transaction():
        state = await conn.fetchval(
            "select state from interview where id = $1 for update", interview_id
        )
        if state != "thinking":  # finished while the model was thinking
            return
        await conn.execute(
            "insert into turn (interview_id, idx, role, text, target_slot) "
            "select $1, coalesce(max(idx), -1) + 1, 'question', $2, $3 from turn "
            "where interview_id = $1",
            interview_id,
            nq.question,
            nq.target_slot,
        )
        await conn.execute(
            "update interview set state = 'asking', coverage = $2 where id = $1",
            interview_id,
            {**coverage, **nq.updated_coverage},
        )


def _context(
    object_name: str,
    observations: list[asyncpg.Record],
    coverage: Coverage,
    turns: list[asyncpg.Record],
) -> str:
    answers = sum(t["role"] == "answer" for t in turns)
    lines = [f"Object: {object_name}", "What the photo shows:"]
    lines += [f"- {o['text']}" for o in observations] or ["- (nothing noted)"]
    lines += [
        f"Coverage so far: {json.dumps(coverage)}",
        f"Answers so far: {answers} of at most {MAX_ANSWERS}.",
        "Conversation (most recent last):",
    ]
    for t in turns[-HISTORY_TURNS:]:
        speaker = "Q" if t["role"] == "question" else "A"
        lines.append(f"{speaker}: {t['text'] or '(no words heard)'}")
    return "\n".join(lines)


async def _wrap_up(conn: asyncpg.Connection, interview_id: UUID, ctx: asyncpg.Record) -> None:
    await conn.execute(
        "update interview set state = 'wrapping_up', ended_at = now() where id = $1", interview_id
    )
    await enqueue(conn, "extract_facts", ctx["heirloom_id"], ctx["family_id"])
