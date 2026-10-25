"""Turns accounts that were added straight into someone's family into two-way connections.

Before connection requests existed, the Family tab put another account into your family with a
shared Friend/Family label. Each such pair becomes a connection both people hold, labelled as
it was, and each gets into the other's home family so both can read each other's stories.

    uv run python scripts/backfill_connections.py           # show what would change
    uv run python scripts/backfill_connections.py --apply
"""

import argparse
import asyncio

import asyncpg

from app.accounts import ACCOUNT_NAME, connect
from app.config import get_settings


async def main(apply: bool) -> None:
    conn = await asyncpg.connect(get_settings().database_url, statement_cache_size=0)
    pairs = await conn.fetch(
        f"""
        select o.user_id as owner, m.user_id as added,
               case when p.relation_label ilike 'friend' then 'friend' else 'family' end as kind,
               {ACCOUNT_NAME.format(user="o.user_id")} as owner_name,
               {ACCOUNT_NAME.format(user="m.user_id")} as added_name, f.name as family
        from member m
        join member o on o.family_id = m.family_id and o.role = 'owner' and o.user_id != m.user_id
        join family f on f.id = m.family_id
        left join person p on p.id = m.person_id
        where not exists (select 1 from connection c
                          where c.user_id = o.user_id and c.other_id = m.user_id)
        """
    )
    for p in pairs:
        print(f"{p['owner_name']} <-> {p['added_name']} as {p['kind']} (from {p['family']!r})")
    if not pairs:
        print("nothing to backfill")
    if apply and pairs:
        async with conn.transaction():
            for p in pairs:
                await connect(conn, p["owner"], p["added"], p["kind"], p["kind"])
        print(f"connected {len(pairs)} pair(s)")
    elif pairs:
        print("dry run: pass --apply to write")
    await conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    asyncio.run(main(parser.parse_args().apply))
