"""Postgres-backed job queue. See DESIGN.md §5.1.

Each (kind, subject_id) pair has one row. Enqueuing again resets it to `queued`, so
re-triggering a stage (say compose_story after a new memory) is idempotent.
"""

from typing import Any, Literal
from uuid import UUID

import asyncpg

JobKind = Literal[
    "analyze_object",
    "lens_lookup",
    "transcribe_turn",
    "next_question",
    "update_coverage",
    "extract_facts",
    "era_context",
    "compose_story",
    "cover_art",
]


async def enqueue(
    conn: asyncpg.Connection, kind: JobKind, subject_id: UUID, family_id: UUID
) -> None:
    await conn.execute(
        """
        insert into job (kind, subject_id, family_id) values ($1, $2, $3)
        on conflict (kind, subject_id) do update
          set status = 'queued', attempts = 0, error = null, updated_at = now()
        """,
        kind,
        subject_id,
        family_id,
    )


async def set_output(
    conn: asyncpg.Connection, kind: JobKind, subject_id: UUID, output: Any
) -> None:
    await conn.execute(
        "update job set output = $3 where kind = $1 and subject_id = $2", kind, subject_id, output
    )
