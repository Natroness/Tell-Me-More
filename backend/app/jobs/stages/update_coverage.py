"""Stage 4b. After a question goes out, marks which parts of the story the answers have told.
Subject is the interview id. Off the narrator's wait: the next question reads whatever map is
here by then."""

from uuid import UUID

from app import providers
from app.db import pool
from app.jobs.stages.next_question import load
from app.models import CoverageUpdate
from app.prompts import prompt


async def run(interview_id: UUID) -> None:
    async with pool().acquire() as conn:
        iv = await load(conn, interview_id)
    if iv is None:
        return
    conversation = "\n".join(
        f"{'Q' if t.role == 'question' else 'A'}: {t.text or '(no words heard)'}" for t in iv.turns
    )
    update = await providers.get_providers().fast.json(
        system=prompt("update_coverage"),
        messages=[
            {
                "role": "user",
                "content": f"Object: {iv.object_name}\nCurrent map: {iv.coverage}\n{conversation}",
            }
        ],
        schema=CoverageUpdate,
        effort="minimal",
    )
    async with pool().acquire() as conn:
        await conn.execute(
            "update interview set coverage = $2 where id = $1",
            interview_id,
            {**iv.coverage, **update.updated_coverage},
        )
