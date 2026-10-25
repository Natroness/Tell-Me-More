# Storytime implementation checklist

Scope: English-only, opt-in family story videos with a fixed AI narrator, original recorded voice clips, family photos, Muse illustrations, optional Pixabay stock, captions, music, and private MP4 playback. The interview/capture hot path stays frozen. No commits or deployment without a request.

## Review completed

- [x] Read the latest HackTX Claude session (`3148729a-923e-42b2-82e8-921e667f94b4`), including its final live Immersive verification.
- [x] Review the product brief, DESIGN, IMMERSIVE, STORYTIME, research, current routes, providers, jobs, storage, tests, and frontend integration points.
- [x] Preserve the existing uncommitted Immersive changes and reuse its slow lane.
- [x] Resolve providers: Gemini TTS with a fixed English voice; Pixabay for optional stock. Both credentials passed live probes in this conversation.

## Ordered implementation

- [x] **1 — Foundation:** migration, domain models, feature flag/settings, TTS/stock protocols and adapters, fakes, storage paths, and slow job registration. Verify the baseline suite and migration locally.
- [x] **2 — Script:** load a published story and its sources, generate/validate a cited English storyboard, constrain original clips to the storyteller and one answer turn, retry invalid output once, and queue rendering transactionally.
- [x] **3 — Render:** resumable asset gathering/narration, measured audio timeline, pure FFmpeg argument builder, captions/title/credits, gentle motion/crossfades, music ducking/muting, MP4/poster upload, and completion notifications. Verify with real FFmpeg.
- [x] **4 — API:** authorization, feature availability, daily cap, idempotent requests, safe retries/regeneration/removal, preserved prior playback, signed URLs, public link access, and generated API types.
- [x] **5 — UI:** native video player, opt-in/progress/retry/regenerate/remove controls, stale badge, credits, Realtime plus polling fallback, member/public story integration, and notification links.
- [x] **6 — Automated verification:** API/RLS/concurrency/resume/cancellation tests, provider tests, full regression suite, lint/types/build, frozen-file checks, and live English narration/stock probes. Record measured results and remaining deployment steps. The opt-in full synthetic e2e command is implemented; its complete live run is tracked below.

## Decisions that refine the original spec

- Use an immutable generation attempt ID as the queued subject; workers only update the currently selected attempt. Removed/replaced attempts cannot overwrite a new video.
- Count all explicit requests in an attempt ledger, including regenerations and requests later removed, under a family lock. Enforce a rolling 24-hour cap.
- Keep the prior successful MP4/poster and its source story ID while regenerating; swap only after success. Staleness describes the playable video's source version.
- Keep database connections and locks out of external model, stock, storage, and encoder calls. Serialize encodes and bound FFmpeg threads in the shared process.
- Stock is optional and carries attribution; unsuitable/unavailable stock falls back to generated art. Do not use unverified SerpApi image results.
- Storytime-generated images must not be mistaken for the existing story cover or family photographs.
- Source narration and captions remain English. Validate actual duration after speech synthesis; never speed up the storyteller to fit.

## Deployment boundary

Keep `STORYTIME_ENABLED=false` by default. Prepare and test the migration against local Postgres first. The user authorized the hosted migration after tests pass. It has been applied and verified on project `kzgssclziixnlqejplqo`. Feature enablement and a real family-story render remain separate opt-in steps.


## Verification results — 2026-10-25

- Backend: **101 tests passed**, including API HTTP contracts, RLS/attempt-ledger access, create authorization/idempotency/concurrency, daily caps after removal/regeneration, source validation, resumption after partial failure, stock fallback, stale playback, cancellation, correct deduplicated notification recipients, provider credential handling/caching, and a real three-scene FFmpeg render.
- `make lint`: passed backend lint/format and frontend types/lint. Only the three existing Fast Refresh warnings in `displayMode.tsx` remain.
- `pnpm --dir frontend build`: passed. Existing Vite configuration/chunk-size warnings remain; no player dependency was added. A scratch-copy comparison measured **1,191 bytes gzip** added to the entry JavaScript, below the 5 KB budget.
- Live adapters: English Gemini Sulafat WAV generated in **3.94 s**; Pixabay returned eight usable images in **0.23 s**, and the renderer downloaded a **398,313-byte JPEG** successfully.
- All **10 frozen files** match their before-implementation SHA-256 digests. `git diff --check` passed.
- Supabase MCP is configured for this project and authenticated with OAuth. The installed CLI 0.145.0 has an issuer callback bug; authentication succeeded using a temporary 0.164.0 CLI, without replacing the global CLI. The new tool was not exposed to this already-running session, so the migration used the matching configured database connection.
- Hosted migration **20261026000000_storytime.sql** applied transactionally and recorded in migration history. SHA-256: `29ad17546f431561a87bd121d704ed80205c2df67c4e8c256a9a5016ac912b06`.
- Hosted readback: both tables have RLS; authenticated members have SELECT on `storytime` with the family membership policy, no client INSERT grant, no anonymous SELECT, no client read of the attempt ledger; `storytime` is published to Realtime.
- The separate legacy whole-schema health check reports 28 pre-existing anonymous table grants across `connection`, `connection_request`, `family_invite`, and `immersive_world` (seven grants each, including write/TRUNCATE privileges). Those tables have RLS, but the broad grants still need a separate review; no unrelated grants were changed. Storytime-specific privilege checks all passed.
- No commits were made; existing Immersive work was preserved.

## Remaining live acceptance checks

- [ ] Enable `STORYTIME_ENABLED=true` on the intended app worker and restart it after confirming FFmpeg/fonts and the configured provider credentials are present there.
- [ ] Create a video explicitly from the story page (or run the synthetic `--storytime` diagnostic). Inspect narration/citations, original-voice cut boundaries, music/captions, and the resulting 60–150 second video.
- [ ] Test logged-in member and public-link playback on a phone, including Realtime/polling progress and regeneration/removal controls.
- [ ] Measure complete generation time and interview latency under a real render on the target worker; the five-minute and ±10% latency targets have not yet been measured.
