import json

import asyncpg

_pool: asyncpg.Pool | None = None


async def _init_connection(conn: asyncpg.Connection) -> None:
    for typ in ("json", "jsonb"):
        await conn.set_type_codec(typ, encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


async def open_pool(dsn: str, max_size: int = 5) -> None:
    global _pool
    # statement_cache_size=0 keeps asyncpg working behind Supabase's transaction pooler.
    # Supabase's session pooler caps clients per project (15 on small plans), so open connections
    # on demand and keep few: the API, the worker and a dev script all share that cap.
    _pool = await asyncpg.create_pool(
        dsn,
        statement_cache_size=0,
        init=_init_connection,
        min_size=1,
        max_size=max_size,
        max_inactive_connection_lifetime=60,
    )


async def close_pool() -> None:
    if _pool is not None:
        await _pool.close()


def pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("DATABASE_URL is not configured")
    return _pool
