"""Verify complete local SQL and an upgrade from the isolated protected baseline.

From backend:
  uv run --python 3.12 --with pgserver python tests/verify_migration_paths.py

Hosted init is recorded as 20261025004500, but its identical local SQL is
20261024000000_init.sql. Replay that dependency before brief_gap, then explicitly
record the hosted identity in the isolated ledger. This verifies schema upgrades
without claiming that numeric hosted-ledger order is a valid replay sequence.
No hosted database or real migration history is modified.
"""

import asyncio
import json
import re
import tempfile
from pathlib import Path
from uuid import UUID, uuid4

import asyncpg
import pgserver

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "supabase" / "migrations"
STUBS = ROOT / "backend" / "tests" / "supabase_stubs.sql"
BASELINE_VERSIONS = (
    "20261024000000",
    "20261025000000",
    "20261025061842",
    "20261025100000",
    "20261025200000",
    "20261025300000",
    "20261026000000",
    "20261027000000",
)
HOSTED_VERSIONS = (
    "20261025000000",
    "20261025004500",
    "20261025061842",
    "20261025100000",
    "20261025200000",
    "20261025300000",
    "20261026000000",
    "20261027000000",
)
PRESERVED_TABLES = (
    "auth.users",
    "family",
    "person",
    "member",
    "relationship",
    "family_invite",
    "profile",
    "heirloom",
    "media",
    "story_request",
    "story",
    "notification",
    "connection_request",
    "connection",
    "immersive_world",
    "storytime",
    "storytime_attempt",
)
PROTECTED_TABLES = (
    "connection_request",
    "connection",
    "immersive_world",
    "storytime",
    "storytime_attempt",
)


def migration_files() -> list[Path]:
    paths = sorted(MIGRATIONS.glob("*.sql"))
    versions = [path.name.split("_", 1)[0] for path in paths]
    assert len(set(versions)) == len(versions), "duplicate migration versions"
    assert set(BASELINE_VERSIONS).issubset(versions), "incomplete protected baseline"
    return paths


async def apply(conn: asyncpg.Connection, path: Path, *, hosted_alias: bool = False) -> None:
    sql = await asyncio.to_thread(path.read_text)
    version, name = path.stem.split("_", 1)
    if hosted_alias and version == "20261024000000":
        version = "20261025004500"
    async with conn.transaction():
        await conn.execute(sql)
        await conn.execute(
            "insert into supabase_migrations.schema_migrations (version, name, statements) "
            "values ($1, $2, $3)",
            version,
            name,
            [sql],
        )


async def prepare(conn: asyncpg.Connection) -> None:
    await conn.execute(await asyncio.to_thread(STUBS.read_text))
    await conn.execute(
        "create schema supabase_migrations; "
        "create table supabase_migrations.schema_migrations "
        "(version text primary key, name text, statements text[])"
    )


async def assert_final_schema(conn: asyncpg.Connection) -> None:
    for table in (
        "family_event",
        "family_memory",
        "private_schedule_entry",
        "notification",
        *PROTECTED_TABLES,
    ):
        assert await conn.fetchval("select to_regclass($1)", f"public.{table}"), table
    check = await conn.fetchval(
        "select pg_get_constraintdef(oid) from pg_constraint "
        "where conrelid = 'notification'::regclass and conname = 'notification_type_check'"
    )
    for value in (
        "request_received",
        "request_declined",
        "story_ready",
        "memory_added",
        "storytime_ready",
        "invite_received",
        "invite_accepted",
        "invite_declined",
    ):
        assert f"'{value}'" in check, value
    media_check = await conn.fetchval(
        "select pg_get_constraintdef(oid) from pg_constraint "
        "where conrelid = 'media'::regclass and conname = 'media_kind_check'"
    )
    for value in ("generated_image", "generated_video", "generated_audio"):
        assert f"'{value}'" in media_check, value
    assert not await conn.fetchval(
        "select exists(select 1 from storage.buckets where public and id <> 'avatars')"
    ), "story and generated-media buckets must remain private"


async def fresh_install(uri: str) -> None:
    """Also used by the Docker-free full pytest runner."""
    conn = await asyncpg.connect(uri)
    try:
        await prepare(conn)
        for path in migration_files():
            await apply(conn, path)
        await assert_final_schema(conn)
    finally:
        await conn.close()


async def seed_baseline(conn: asyncpg.Connection) -> dict[str, UUID | str]:
    ids: dict[str, UUID | str] = {
        key: uuid4()
        for key in (
            "owner",
            "relative",
            "outsider",
            "family",
            "owner_person",
            "relative_person",
            "heirloom",
            "photo",
            "recording",
            "poster",
            "video",
            "narration",
            "request",
            "story",
            "world",
            "storytime",
            "generation",
        )
    }
    await conn.executemany(
        "insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())",
        [(ids[key], f"{key}-upgrade@example.com") for key in ("owner", "relative", "outsider")],
    )
    await conn.execute(
        "insert into family (id, name, invite_code) values ($1, 'Preserved', 'upgrade')",
        ids["family"],
    )
    await conn.executemany(
        "insert into person (id, family_id, display_name) values ($1, $2, $3)",
        [
            (ids["owner_person"], ids["family"], "Owner Person"),
            (ids["relative_person"], ids["family"], "Relative Person"),
        ],
    )
    await conn.executemany(
        "insert into member (user_id, family_id, person_id, role) values ($1, $2, $3, $4)",
        [
            (ids["owner"], ids["family"], ids["owner_person"], "owner"),
            (ids["relative"], ids["family"], ids["relative_person"], "member"),
        ],
    )
    await conn.execute(
        "insert into relationship (family_id, a, b, kind) values ($1, $2, $3, 'sibling')",
        ids["family"],
        ids["owner_person"],
        ids["relative_person"],
    )
    await conn.execute(
        "insert into profile (user_id, display_name, age, ui_mode) "
        "values ($1, 'Private profile name', 72, 'regular')",
        ids["relative"],
    )
    await conn.execute(
        "insert into family_invite "
        "(family_id, inviter_user_id, anchor_person_id, kind, email, status, "
        "accepted_user_id, person_id, responded_at) "
        "values ($1, $2, $3, 'sibling', 'relative-upgrade@example.com', 'accepted', $4, $5, now())",
        ids["family"],
        ids["owner"],
        ids["owner_person"],
        ids["relative"],
        ids["relative_person"],
    )
    await conn.execute(
        "insert into connection_request (from_user, to_user, kind, status, responded_at) "
        "values ($1, $2, 'friend', 'accepted', now())",
        ids["owner"],
        ids["relative"],
    )
    await conn.executemany(
        "insert into connection (user_id, other_id, kind) values ($1, $2, $3)",
        [
            (ids["owner"], ids["relative"], "friend"),
            (ids["relative"], ids["owner"], "family"),
        ],
    )
    await conn.execute(
        "insert into heirloom (id, family_id, title, signature, created_by) "
        "values ($1, $2, 'Preserved object', 'brass lamp', $3)",
        ids["heirloom"],
        ids["family"],
        ids["owner"],
    )
    for key, kind, mime, extension in (
        ("photo", "photo", "image/jpeg", "jpg"),
        ("recording", "audio", "audio/wav", "wav"),
        ("poster", "generated_image", "image/png", "png"),
        ("video", "generated_video", "video/mp4", "mp4"),
        ("narration", "generated_audio", "audio/mpeg", "mp3"),
    ):
        path = f"{ids['family']}/{ids['heirloom']}/{ids[key]}.{extension}"
        await conn.execute(
            "insert into media "
            "(id, family_id, heirloom_id, kind, storage_path, mime, created_by) "
            "values ($1, $2, $3, $4, $5, $6, $7)",
            ids[key],
            ids["family"],
            ids["heirloom"],
            kind,
            path,
            mime,
            ids["owner"],
        )
        bucket = "photos" if key == "photo" else "audio" if key == "recording" else "generated"
        await conn.execute(
            "insert into storage.objects (bucket_id, name) values ($1, $2)", bucket, path
        )
    await conn.execute(
        "update heirloom set cover_media_id = $2 where id = $1", ids["heirloom"], ids["photo"]
    )
    await conn.execute(
        "insert into story_request "
        "(id, heirloom_id, capture_media_id, listener_id, storyteller_id, status) "
        "values ($1, $2, $3, $4, $5, 'completed')",
        ids["request"],
        ids["heirloom"],
        ids["photo"],
        ids["owner_person"],
        ids["relative_person"],
    )
    await conn.execute(
        "insert into story "
        "(id, heirloom_id, version, title, blocks, request_id, storyteller_id, recording_media_id) "
        "values ($1, $2, 1, 'Preserved story', '[]', $3, $4, $5)",
        ids["story"],
        ids["heirloom"],
        ids["request"],
        ids["relative_person"],
        ids["recording"],
    )
    world_path = f"{ids['family']}/world/{ids['world']}/scene.spz"
    ids["world_path"] = world_path
    await conn.execute(
        "insert into immersive_world "
        "(id, family_id, heirloom_id, source_media_id, requested_by, requested_by_person, "
        "status, assets, story_id) values ($1, $2, $3, $4, $5, $6, 'ready', $7::jsonb, $8)",
        ids["world"],
        ids["family"],
        ids["heirloom"],
        ids["photo"],
        ids["owner"],
        ids["owner_person"],
        json.dumps({"spz_100k": world_path}),
        ids["story"],
    )
    await conn.execute(
        "insert into storage.objects (bucket_id, name) values ('generated', $1)", world_path
    )
    await conn.execute(
        "insert into storytime "
        "(id, family_id, heirloom_id, story_id, requested_by, generation_id, status, "
        "video_media_id, poster_media_id, video_story_id, duration_ms) "
        "values ($1, $2, $3, $4, $5, $6, 'ready', $7, $8, $4, 10000)",
        ids["storytime"],
        ids["family"],
        ids["heirloom"],
        ids["story"],
        ids["owner"],
        ids["generation"],
        ids["video"],
        ids["poster"],
    )
    await conn.execute(
        "insert into storytime_attempt "
        "(id, family_id, heirloom_id, storytime_id, requested_by) values ($1, $2, $3, $4, $5)",
        ids["generation"],
        ids["family"],
        ids["heirloom"],
        ids["storytime"],
        ids["owner"],
    )
    # Regeneration is valid in the protected schema; both rows must survive upgrade.
    for _ in range(2):
        await conn.execute(
            "insert into notification (recipient_id, type, request_id, story_id) "
            "values ($1, 'storytime_ready', $2, $3)",
            ids["relative_person"],
            ids["request"],
            ids["story"],
        )
    return ids


async def snapshot_rows(conn: asyncpg.Connection) -> dict[str, list[dict]]:
    # SQL identifiers come only from the fixed table allowlist.
    result = {}
    for table in PRESERVED_TABLES:
        rows = await conn.fetchval(f"select array_agg(to_jsonb(t)::text) from {table} t")
        result[table] = [json.loads(row) for row in rows]
    return result


async def protected_catalog(conn: asyncpg.Connection) -> tuple:
    constraints = await conn.fetch(
        "select r.relname, c.conname, pg_get_constraintdef(c.oid) as definition "
        "from pg_constraint c join pg_class r on r.oid = c.conrelid "
        "where r.relname = any($1::text[]) order by 1, 2",
        [*PROTECTED_TABLES, "media"],
    )
    policies = await conn.fetch(
        "select tablename, policyname, roles, cmd, qual, with_check from pg_policies "
        "where schemaname = 'public' and tablename = any($1::text[]) order by 1, 2",
        list(PROTECTED_TABLES),
    )
    grants = [
        await conn.fetchval("select has_table_privilege($1, $2, $3)", role, table, permission)
        for role in ("anon", "authenticated")
        for table in PROTECTED_TABLES
        for permission in (
            "SELECT",
            "INSERT",
            "UPDATE",
            "DELETE",
            "TRUNCATE",
            "REFERENCES",
            "TRIGGER",
        )
    ]
    return constraints, policies, grants


async def verify_protected_access(conn: asyncpg.Connection, ids: dict[str, UUID | str]) -> None:
    for user, expected in (("relative", 1), ("outsider", 0)):
        async with conn.transaction():
            await conn.execute("set local role authenticated")
            await conn.execute(
                "select set_config('request.jwt.claim.sub', $1, true)", str(ids[user])
            )
            for table in ("immersive_world", "storytime"):
                assert await conn.fetchval(f"select count(*) from {table}") == expected
            assert (
                await conn.fetchval(
                    "select count(*) from storage.objects where name = $1", ids["world_path"]
                )
                == expected
            )
            assert (
                await conn.fetchval(
                    "select count(*) from notification where type = 'storytime_ready'"
                )
                == expected * 2
            )
            assert not await conn.fetchval(
                "select has_table_privilege(current_user, 'storytime_attempt', 'SELECT')"
            ), "internal generation ledger must remain inaccessible"


def canonical_rows(rows: list[dict], keys: list[str]) -> list[str]:
    return sorted(json.dumps({key: row[key] for key in keys}, sort_keys=True) for row in rows)


async def upgrade_hosted_baseline(uri: str) -> None:
    conn = await asyncpg.connect(uri)
    try:
        await prepare(conn)
        paths = migration_files()
        for path in paths:
            if path.name[:14] in BASELINE_VERSIONS:
                await apply(conn, path, hosted_alias=True)
        assert (
            tuple(
                await conn.fetchval(
                    "select array_agg(version order by version) "
                    "from supabase_migrations.schema_migrations"
                )
            )
            == HOSTED_VERSIONS
        )
        ids = await seed_baseline(conn)
        # Read-only hosted inspection found Supabase default-privilege grants on these
        # tables, beyond the repository's explicit SELECT grants. Reproduce that drift
        # only in this isolated baseline and verify supporting SQL leaves it untouched.
        await conn.execute(
            "grant all on connection_request, connection, immersive_world to anon, authenticated"
        )
        rows_before = await snapshot_rows(conn)
        catalog_before = await protected_catalog(conn)
        realtime_before = set(
            await conn.fetchval(
                "select array_agg(tablename) from pg_publication_tables "
                "where pubname = 'supabase_realtime' and schemaname = 'public'"
            )
        )
        for path in paths:
            if path.name[:14] not in BASELINE_VERSIONS:
                await apply(conn, path)
        await assert_final_schema(conn)
        rows_after = await snapshot_rows(conn)
        for table, before in rows_before.items():
            keys = list(before[0])
            assert canonical_rows(before, keys) == canonical_rows(rows_after[table], keys), table
        constraints_after, policies_after, grants_after = await protected_catalog(conn)
        # Memories adds media FKs; every pre-existing media constraint must remain.
        for constraint in catalog_before[0]:
            extensions = {
                "immersive_world_input_mode_check": "reference",
                "immersive_world_status_check": "finding_reference",
            }
            if constraint["relname"] == "immersive_world" and constraint["conname"] in extensions:
                # The already-merged reference-photo migration deliberately extends these
                # enums. Require precisely that extension, preserving every former value.
                updated = next(
                    c
                    for c in constraints_after
                    if c["relname"] == "immersive_world" and c["conname"] == constraint["conname"]
                )
                old_values = set(re.findall(r"'([^']+)'::text", constraint["definition"]))
                new_values = set(re.findall(r"'([^']+)'::text", updated["definition"]))
                assert new_values == old_values | {extensions[constraint["conname"]]}
                continue
            assert constraint in constraints_after, constraint
        assert catalog_before[1] == policies_after, "protected RLS changed"
        assert catalog_before[2] == grants_after, "protected grants changed"
        realtime_after = set(
            await conn.fetchval(
                "select array_agg(tablename) from pg_publication_tables "
                "where pubname = 'supabase_realtime' and schemaname = 'public'"
            )
        )
        assert realtime_before <= realtime_after, "protected Realtime tables removed"
        profile = await conn.fetchrow(
            "select display_name, preferred_language, ui_mode, ui_mode_overridden "
            "from profile where user_id = $1",
            ids["relative"],
        )
        assert tuple(profile) == ("Private profile name", "en", "regular", True)
        await verify_protected_access(conn, ids)
        await conn.execute(
            "insert into notification (recipient_id, type, request_id, story_id) "
            "values ($1, 'storytime_ready', $2, $3)",
            ids["relative_person"],
            ids["request"],
            ids["story"],
        )
    finally:
        await conn.close()


def main() -> None:
    for label, check in (
        ("complete fresh installation", fresh_install),
        ("hosted-ledger protected baseline upgrade and data preservation", upgrade_hosted_baseline),
    ):
        with tempfile.TemporaryDirectory(prefix="tmm-migration-") as directory:
            server = pgserver.get_server(directory, cleanup_mode="stop")
            try:
                asyncio.run(check(server.get_uri()))
            finally:
                server.cleanup()
        print(f"{label}: ok")
    print("protected constraints, grants, RLS, Storage SQL policies, and Realtime: ok")
    print("scope: isolated PostgreSQL with Supabase stubs; no hosted or Storage HTTP verification")


if __name__ == "__main__":
    main()
