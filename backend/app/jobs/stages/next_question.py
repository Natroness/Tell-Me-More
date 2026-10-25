"""Stage 4. The interview so far -> the next question, or the end. Subject is the interview id.

Someone is waiting on every question, so the model writes only the question text at minimal
effort. The coverage map that steers later questions is updated afterwards by update_coverage.
The streaming answer path (routers/answer_stream.py) calls `ask` and `save` directly instead of
going through the queue; this job is the path for uploaded answers.
"""

import json
import re
from dataclasses import dataclass, replace
from typing import get_args
from uuid import UUID

import asyncpg

from app import providers
from app.db import pool
from app.jobs.queue import enqueue
from app.models import Coverage, Slot
from app.prompts import prompt

MAX_QUESTIONS = 10
HISTORY_TURNS = 8  # last 4 question/answer pairs keep the prompt small and the reply fast
WRAP_UP = "WRAP_UP"


@dataclass(frozen=True)
class Turn:
    id: UUID
    role: str
    text: str | None


@dataclass(frozen=True)
class Interview:
    id: UUID
    heirloom_id: UUID
    family_id: UUID
    state: str
    language: str
    coverage: Coverage
    object_name: str
    narrator: str
    relation: str
    observations: list[str]
    turns: list[Turn]

    @property
    def questions_asked(self) -> int:
        return sum(t.role == "question" for t in self.turns)

    def answered(self, turn_id: UUID, text: str) -> "Interview":
        """As if this answer were already saved."""
        return replace(
            self, turns=[replace(t, text=text) if t.id == turn_id else t for t in self.turns]
        )


async def load(conn: asyncpg.Connection, interview_id: UUID) -> Interview | None:
    r = await conn.fetchrow(
        """
        select i.state, i.coverage, i.language, i.heirloom_id, h.family_id,
               coalesce(h.title, h.category, 'a family heirloom') as object_name,
               p.display_name, coalesce(p.relation_label, 'a family member') as relation,
               (select coalesce(json_agg(f.text order by f.confidence desc nulls last), '[]')
                  from (select text, confidence from fact
                         where heirloom_id = i.heirloom_id and kind = 'observation'
                         order by confidence desc nulls last limit 8) f) as observations,
               (select coalesce(json_agg(json_build_object(
                         'id', t.id, 'role', t.role, 'text', t.text) order by t.idx), '[]')
                  from turn t where t.interview_id = i.id) as turns
        from interview i
        join heirloom h on h.id = i.heirloom_id
        join person p on p.id = i.narrator_id
        where i.id = $1
        """,
        interview_id,
    )
    if r is None:
        return None
    return Interview(
        id=interview_id,
        heirloom_id=r["heirloom_id"],
        family_id=r["family_id"],
        state=r["state"],
        language=r["language"],
        coverage={slot: (r["coverage"] or {}).get(slot, "open") for slot in get_args(Slot)},
        object_name=r["object_name"],
        narrator=r["display_name"],
        relation=r["relation"],
        observations=r["observations"],
        turns=[Turn(UUID(t["id"]), t["role"], t["text"]) for t in r["turns"]],
    )


async def ask(iv: Interview) -> str | None:
    """The next question, or None when the interview should end."""
    if iv.questions_asked >= MAX_QUESTIONS:
        return None
    reply = await providers.get_providers().fast.text(
        system=prompt(
            "next_question",
            narrator=iv.narrator,
            relation=iv.relation,
            object=iv.object_name,
            language=iv.language,
            max_questions=str(MAX_QUESTIONS),
        ),
        messages=[{"role": "user", "content": _context(iv)}],
        effort="minimal",
    )
    question = re.sub(r"\s+", " ", reply).strip().strip('"').strip()
    return None if not question or WRAP_UP in question else question


async def save(conn: asyncpg.Connection, iv: Interview, question: str | None) -> UUID | None:
    """Asks the question, or wraps up, if the interview is still waiting on one. Returns the new
    question turn. Run inside a transaction."""
    state = await conn.fetchval("select state from interview where id = $1 for update", iv.id)
    if state != "thinking":  # ended, or already answered, while the model was thinking
        return None
    if question is None:
        await conn.execute(
            "update interview set state = 'wrapping_up', ended_at = now() where id = $1", iv.id
        )
        await enqueue(conn, "extract_facts", iv.heirloom_id, iv.family_id)
        return None
    turn_id = await conn.fetchval(
        "insert into turn (interview_id, idx, role, text) "
        "select $1, coalesce(max(idx), -1) + 1, 'question', $2 from turn "
        "where interview_id = $1 returning id",
        iv.id,
        question,
    )
    await conn.execute("update interview set state = 'asking' where id = $1", iv.id)
    await enqueue(conn, "update_coverage", iv.id, iv.family_id)
    return turn_id


async def run(interview_id: UUID) -> None:
    async with pool().acquire() as conn:
        iv = await load(conn, interview_id)
    if iv is None or iv.state != "thinking":
        return
    question = await ask(iv)
    async with pool().acquire() as conn, conn.transaction():
        await save(conn, iv, question)


def _context(iv: Interview) -> str:
    asked = iv.questions_asked
    lines = [f"Object: {iv.object_name}", "What the photo shows:"]
    lines += [f"- {o}" for o in iv.observations] or ["- (nothing noted)"]
    lines += [
        f"Coverage so far: {json.dumps(iv.coverage)}",
        f"Questions asked so far: {asked} of at most {MAX_QUESTIONS}."
        + (" The next one is the last." if asked == MAX_QUESTIONS - 1 else ""),
        "Conversation (most recent last):",
    ]
    for t in iv.turns[-HISTORY_TURNS:]:
        speaker = "Q" if t.role == "question" else "A"
        lines.append(f"{speaker}: {t.text or '(no words heard)'}")
    return "\n".join(lines)
