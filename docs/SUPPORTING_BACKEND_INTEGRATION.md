# Main-based supporting backend integration

This records the original review. The later authorized hosted application and frontend
verification are documented in [FRONTEND_INTEGRATION.md](FRONTEND_INTEGRATION.md).

Base: `origin/main` at `5980bca6b9d8ba6a955f6b3b1abf29b12f90bf0d`.
Review branch: `codex/supporting-main-integration`.

This worktree selectively adds supporting backend functionality to main. Main's
frontend implementation, authentication, account/connections behavior, protected
pipeline, providers, prompts, models, worker, world model, and Storytime renderer
are preserved. Only generated `frontend/src/api-types.ts` changes in the frontend.
No commits, merges, pushes, deployments, or hosted writes were performed.

## Ported features and database requirements

| Feature | Backend entry points | Required supporting migration |
| --- | --- | --- |
| Events / Important Dates | `routers/events.py` | `20261028000000_family_events.sql` |
| Owner-private schedules and derived availability | `routers/availability.py` | `20261028010000_family_availability.sql` |
| Family Memories, draft/publish and verified media | `routers/memories.py` | `20261028020000_family_memories.sql`, after Events' person/family key |
| Timeline | `routers/timeline.py` | Events and Memories; timeline index also supplied by Notifications/Preferences |
| Notifications | `routers/notifications.py` | `20261028030000_notifications_preferences.sql`, after Memories |
| Language and manual display preferences | `routers/profiles.py` | `20261028030000_notifications_preferences.sql` |

The existing family tree/invitation backend and its tests are retained as supporting
dependencies. `20261025061842_family_invites.sql` is restored unchanged; it was
already applied on TellmeMore and must not be replayed there.

The four `20261028…` migrations were absent from the last read-only TellmeMore
ledger inspection. The owner confirmed they have never been applied in any database,
so their notification and storage compatibility corrections are made in those files.
Execute them in the table's timestamp order only after resolving the history blocker.

## Compatibility retained

- Notification deduplication applies to once-per-request supporting actions, not
  repeated `storytime_ready` generations. The expanded notification/media checks remain.
- Storytime notifications retain recipient and heirloom response fields and support
  listing, unread counts, and reading. Source membership and retained published
  playback are rechecked. Supporting invitation/memory notification types remain.
- Storage policy recognizes authorized world assets and Storytime asset references
  without requiring artificial media rows. Memory drafts, pending attachments,
  wrong buckets, and cross-family objects remain protected.
- Main's cross-family participant inbox remains; an optional family filter is added.
  Account-backed people/search, relationship fields, and owner-first family order remain.
- Profile preferences reuse main's account-name resolution; preference-only changes
  preserve the chosen account name.
- Main's storage helpers and legacy object-memory route remain. Supporting deletion
  checks include world/Storytime references and safe retries after Storage success
  followed by database failure.
- Friend connections continue using main's established family-membership semantics.
  No additional tree-only restriction or hosted grant changes are introduced.

## Verification

- Full isolated backend suite: **155 passed, 1 failed in 10.91s**. All 15 added
  compatibility regressions pass, including two real stage completions/regenerations
  with fake providers and media execution.
- Complete fresh installation: passed.
- Isolated upgrade from the hosted-version ledger and complete protected schema:
  passed. Existing identities, families, memberships, relationships, invitations,
  connections, protected records, and duplicate Storytime notifications survive.
- Protected constraints, grants, RLS, Storage SQL policies, and Realtime checks: passed.
- Ruff lint: passed. Ruff formatting: 99 files already formatted.
- `make types`: passed. Main frontend `tsc -b`: passed.
- `git diff --check`: passed.

Tests use disposable embedded PostgreSQL with Supabase-managed-schema stubs, not
Docker or live records. Storage authorization is verified through SQL policies and
fake Storage API calls; hosted Storage HTTP and browser journeys are unverified.
Application dependency files and lockfiles are unchanged.

Reproduction from `backend/` (invocation-only pgserver dependency):

```sh
uv run --frozen --python 3.12 --with pgserver python tests/verify_migration_paths.py
uv run --frozen --python 3.12 --with pgserver python tests/run_embedded.py -q
uv run ruff check app tests scripts
uv run ruff format --check app tests scripts
```

Regenerate/check frontend from the worktree root:

```sh
COREPACK_ENABLE_AUTO_PIN=0 make types
COREPACK_ENABLE_AUTO_PIN=0 pnpm --dir frontend exec tsc -b
```

## Existing FFmpeg failure

`test_real_ffmpeg_timeline_and_caption_smoke` fails with the protected renderer's
chained `xfade` constant-frame-rate error (`1/0`) using FFmpeg 7.1 with libass.
The same failure was reproduced on an untouched snapshot of main. The system's
FFmpeg 8.1 additionally lacks subtitle/libass support. The renderer and test remain
unchanged; the suite is not fully green. No tests were skipped or weakened.

## Hosted migration blocker

The last authorized hosted dry-run failed with `DbPushMissingLocalError` for
`20261025004500`. Hosted init is recorded under that version, while both repository
branches contain `20261024000000_init.sql`. The SQL is byte-identical, SHA-256:
`f775f9887d794ffc2c5fe318fe9eec2ec44fd9b1990283cbb347b7a4352d2fc1`.

The canonical local fresh-install order is init `20261024000000`, then dependent
brief-gap `20261025000000`. Simply restoring init under the hosted filename would
put its dependencies in the wrong replay order. Applied SQL remains unchanged.
The upgrade harness explicitly represents the hosted ledger alias locally; it does
not repair hosted history or establish deployment readiness.

Any hosted ledger-alias reconciliation requires a separate reviewed authorization.
No history repair or hosted migration application has been performed. The integrated
profile and notification APIs require the pending columns/tables as well, so this
code must not be deployed against the unchanged hosted schema.
