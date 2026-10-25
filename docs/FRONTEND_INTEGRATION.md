# Frontend integration — 2026-10-25

Integrated remote main `a782e04` (the Natroness frontend redesign) by fast-forward from
`c68c3b5`. Local Storytime changes, including untracked files, were stashed and restored
without conflicts. Recovery references are retained locally:

- `codex/before-frontend-a782e04`: previous main.
- `refs/codex/storytime-before-frontend-a782e04`: complete pre-pull local stash,
  `9e4b9ad546ecae97d4945968e7c5190ed62dc422`.

No commit or push was made. Additional Immersive edits appeared from another session
during this work and were preserved; their reference-photo migration is outside this rollout.

## Integration fixes

- Ported the shorter Storytime description into the redesigned component actually used by
  member/public story pages. Restored Realtime updates, completion haptics, detailed safe
  failure messages, and owner cancellation while gathering/rendering. Public viewers and
  non-owners no longer see Remove. Create/Remove cannot race through enabled buttons.
- Restored the streaming answer's next-question/end payload, closed-socket handling, and
  timeout cleanup. The interview updates immediately from that reply and polls when an
  uploaded answer needs background processing, even without Realtime.
- Leaving an interview stops the microphone, AudioContext, and open answer stream. Failed
  answer creation also stops a microphone that finishes opening later. Recording stop is
  idempotent; failed worklet loading releases the device; pause excludes late queued frames.
- Account changes clear cached family/private data. Initial session loading cannot overwrite
  a more recent auth event. Configuration/network errors use user-facing messages.
- English remains the only selectable language, including devices with old preferences.
- Immersive polling checks every pending world rather than only the first world.
- Schedule time-zone options are deduplicated when UTC/device/saved values overlap.

## Hosted schema rollout

Read-only preflight confirmed project `kzgssclziixnlqejplqo` and missing supporting tables/
profile columns. The previously authorized migration rollout was completed after the isolated
fresh-install, hosted-baseline upgrade, preservation/RLS checks, and backend suite passed.
These exact existing files were applied together in one transaction, with a three-second
lock timeout and twenty-second statement timeout, then recorded in migration history:

| Migration | SHA-256 |
| --- | --- |
| `20261028000000_family_events.sql` | `e34718be95250373641f726896663f2d010f835dbda9d3d8afdb9f48a447f17f` |
| `20261028010000_family_availability.sql` | `3fdd7e3ffd22f3791486f7a30e2adaec4531b815ff0b22f7a902b738175d7b32` |
| `20261028020000_family_memories.sql` | `5f93f806df2e4ebff11273f9c7b498a1a1cd0b358b26af8b51235411a51c2c98` |
| `20261028030000_notifications_preferences.sql` | `fa00aab7d258a575dc5e94aba9e3e93b539fa13b334fc290da79809be06fc2dd` |

All six new tables have RLS, authenticated SELECT, and no anonymous grants or client write
grants. Readback confirmed a member sees only their own profile and no other private
schedule. Existing profile/object/media/story/video/world/notification row counts were
unchanged. Existing migration entries were preserved exactly. The pre-rollout ledger and
SQL hash manifest are saved in `.git/codex-backups/frontend-a782e04/`.

The historical init-version alias still needs reconciliation before using a blanket
Supabase CLI `db push`. This rollout executed only the four reviewed SQL files and added
their history entries; it did not rename, delete, or replay existing migrations.

## Verification

- **175 backend tests passed** in 12.89 s, including the additional concurrent Immersive work
  present at verification time. Fresh installation and upgrade from the hosted baseline
  passed preservation, grants, RLS, Storage-policy, and Realtime checks.
- **58 browser checks passed** in 57.3 s, using desktop Chromium and a mobile viewport/touch
  configuration. Coverage includes the home/family/story/date/memory/availability/timeline/
  account screens, English controls, horizontal overflow, public/non-owner video controls,
  H.264/AAC playback, account switching, camera capture/review, microphone cleanup, pause/
  resume, streaming next questions, and WAV fallback/polling without Realtime.
- **16 read-only hosted-backed API requests returned 200** through the FastAPI ASGI layer:
  profile, families, notifications/count, availability/settings/schedule, family tree,
  memories, dates, timeline, connections/requests, object detail, story, and Storytime.
  These used a scoped in-process auth dependency for an existing member; the live server's
  auth configuration was not changed.
- `make lint`, TypeScript, production build, and `git diff --check` passed. The remote
  redesign's six Fast Refresh warnings, Vite config/chunk warnings, and existing
  `openapi-typescript` TypeScript-5 peer range against TypeScript 6 remain non-blocking.
- Mobile home and story screenshots inspected. Local backend and the existing Cloudflared
  frontend both returned HTTP 200 after integration.

Browser tests use synthetic sessions, mock every API/Auth/Realtime request, and use fake
camera/microphone devices. They send no emails, mutate no hosted family data, and incur no
generation requests. They run on port **4175**, separate from the user's app on 5173.
Mobile browser emulation does not replace checking physical iPhone/Safari permissions and
real email sign-in; those journeys were not performed.

Run again from the repository root:

```sh
pnpm --dir frontend exec playwright install chromium --only-shell
pnpm --dir frontend test:ui
make lint
pnpm --dir frontend build
cd backend
uv run --frozen --python 3.12 --with pgserver python tests/run_embedded.py -q
```

The 3.4 KB playback fixture is a one-second synthetic color frame with silent audio,
generated with FFmpeg; it contains no family content. Playwright is pinned as a development
dependency and is excluded from the application bundle.
