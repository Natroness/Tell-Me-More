import json

import asyncpg

_pool: asyncpg.Pool | None = None


async def _init_connection(conn: asyncpg.Connection) -> None:
    for typ in ("json", "jsonb"):
        await conn.set_type_codec(typ, encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


async def open_pool(dsn: str) -> None:
    global _pool
    # statement_cache_size=0 keeps asyncpg working behind Supabase's transaction pooler.
    _pool = await asyncpg.create_pool(dsn, statement_cache_size=0, init=_init_connection)


async def close_pool() -> None:
    if _pool is not None:
        await _pool.close()


def pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("DATABASE_URL is not configured")
    return _pool
