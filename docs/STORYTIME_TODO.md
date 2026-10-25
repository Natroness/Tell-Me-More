# Storytime implementation checklist

Scope: English-only, opt-in family story videos with a fixed AI narrator, original recorded voice clips, family photos, Muse illustrations, optional Pixabay stock, captions, music, and private MP4 playback. The interview/capture hot path stays frozen. No commits or deployment without a request.

## Review completed

- [x] Read the latest HackTX Claude session (`3148729a-923e-42b2-82e8-921e667f94b4`), including its final live Immersive verification.
- [x] Review the product brief, DESIGN, IMMERSIVE, STORYTIME, research, current routes, providers, jobs, storage, tests, and frontend integration points.
- [x] Preserve the existing uncommitted Immersive changes and reuse its slow lane.
- [x] Resolve providers: Gemini TTS with a fixed English voice; Pixabay for optional stock. Both credentials passed live probes in this conversation.

## Ordered implementation

### Shorter, faster, context-led videos — 2026-10-25

- [x] Fast-forward the clean local main to remote `c68c3b5`, preserving `5980bca` on `codex/storytime-before-main-c68c3b5`.
- [x] Run the integrated baseline: 155 passed, one FFmpeg environment failure; verify the installed libass-capable binary separately.
- [x] Separate the exact speech transcript from delivery metadata; invalidate cached prompt-prefixed audio.
- [x] Halve the duration target to 30–75 seconds, reduce script/voice budgets and cards/pauses, preserve complete original speech.
- [x] Generate pictures and bounded concurrent narration together, reuse repeated assets locally, and avoid repeated image scaling per frame.
- [x] Align scene changes with context and measured speech; choose stock by subject tags and provide scene-grounded illustration fallbacks.
- [x] Verify resumption/cancellation, concurrency, duration, captions, real multi-scene FFmpeg, live English TTS, and encoder timings; document limits.

Verification for this revision:

- **167 backend tests passed** in 12.54 s, including a complete seven-scene 720p H.264/AAC
  render with real FFmpeg, removal during parallel preparation, cache invalidation/resumption,
  image relevance ranking, and measured caption timing. No hosted records were changed.
- `make lint` and frontend production build passed; the three existing Fast Refresh warnings
  and existing Vite configuration/chunk-size warnings remain. Frozen interview/capture files
  match `c68c3b5`; `git diff --check` passed.
- Live English TTS + independent Meta ASR: 4.22 s to produce 5.72 s of narration; the
  transcription contains the story sentence and no delivery instruction. A subsequent
  stateless TTS service probe passed in 2.35 s. Pixabay returned eight images in 0.37 s.
- Fixed local executable selection: `uv` selected the broken Homebrew `ffmpeg/8.1` binary
  (missing x265 library). Local ignored `backend/.env` now selects the installed libass-capable
  `ffmpeg-full/8.1.1` binaries via `FFMPEG_BINARY`/`FFPROBE_BINARY`. No package installation.
- Same seven-scene synthetic 720p gradient/caption/music workload on this Mac:

  | Renderer | Video duration | Encode time |
  | --- | ---: | ---: |
  | Previous `c68c3b5` renderer | 60 s | 9.72 s |
  | Updated renderer | 60 s | 5.11 s |
  | Updated renderer, half-length edit | 30 s | 2.74 s |

  These are individual local encoder measurements, not full generation benchmarks. Muse
  image latency, stock discovery, speech synthesis and upload time still affect total wait.
  A new family story should be generated for visual/editorial acceptance; existing ready
  videos retain their old edit until the owner chooses Regenerate.
- Storytime changes require no new migration or API key. The separately pulled supporting
  backend migrations were subsequently applied during the
  [frontend integration](FRONTEND_INTEGRATION.md); the historical init-version CLI alias
  remains unchanged.

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
- [ ] Create a video explicitly from the story page (or run the synthetic `--storytime` diagnostic). Inspect narration/citations, original-voice cut boundaries, music/captions, and the resulting 30–75 second video.
- [ ] Test logged-in member and public-link playback on a phone, including Realtime/polling progress and regeneration/removal controls.
- [ ] Measure complete generation time and interview latency under a real render on the target worker; the five-minute and ±10% latency targets have not yet been measured.
