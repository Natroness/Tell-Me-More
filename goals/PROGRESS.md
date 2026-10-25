# Progress — updated by orchestrator after each verification

Format: `YYYY-MM-DD HH:MM UTC — phase — result — evidence`

## Log
- 2026-10-25 — Phase 1 complete — repo audited. Backend 6 routers/8 stages/28 tests; frontend 7 routes; missing requests/notifications/display-modes/video/review. Evidence: backend/app/routers/*.py, frontend/src/routes/*.tsx, supabase/migrations/20261024000000_init.sql
- 2026-10-25 — Goals created — GOALS.md G0–G12, AGENTS.md loop, PROGRESS.md log
- 2026-10-25 — Phase 2 complete — PLAN.md written (data → API → UI shell → listener → storyteller → reliability → verify)
- 2026-10-25 — Phase 3 complete — backend: 20261025000000_brief_gap.sql (profile, story_request, notification, upload_status, story link/status, RLS+Realtime), routers requests/notifications/profiles wired in main.py, test_brief_gap.py (3 tests). Frontend: displayMode, Screen, Home, Onboarding, Settings, MyRequests, Notifications, RequestDetail, captureStore, Capture v2 (photo/video/switch/upload/back/permissions/60s timer), Review (blur flag), Archive (upload/search/match states, DEMO label), ChooseStoryteller, RequestConfirm, RecordStory (audio + one-at-a-time follow-ups + share), Tell, ReviewShare, StoryView photo/people/memory blocks + storyteller + follow-up, main.tsx 18 routes, realtime extended. Evidence: 31 backend tests pass, tsc clean, vite build ok
- 2026-10-25 — Phase 4 complete — dev servers booted (:8000 health ok, new /api/requests|notifications|profile in OpenAPI; :5173 all 16 paths resolve: 15 protected → AuthGate sign-in, /s/:id → Loading). Console: no new JS errors (only expected 404 on fake public id + pre-existing query-undefined warning). 401 noise from pre-auth profile fetch fixed via session guard.

## Status per goal
| Goal | Status | Notes |
|------|--------|-------|
| G0 ground truth | done | brief + DESIGN + sessions read |
| G1 Home | done | Home.tsx Discover + Open camera + 4 destinations + unread badge |
| G2 Capture | done | photo/video tabs, timer/REC/60s, switch camera, upload, back, permission errors |
| G3 Review | done | Review.tsx preview, heading, retake/use, replay, blur flag + manual fallback |
| G4 Archive | done | Archive.tsx upload→search→match states, pending→status, none→create, failed→retry/anyway, DEMO label |
| G5 Choose storyteller | done | cards, preview+message+Send(idempotency), invite fallback preserves capture |
| G6 Request confirm | done | save-only, heading+message, Back home/View request, pending note |
| G7 Playback | done | StoryView photo/people/memory blocks, storyteller name, follow-up, captions note |
| G8 Storyteller | done | RequestDetail accept/decline, RecordStory audio+follow-ups+share/draft, ReviewShare edit+share, Tell standalone |
| G9 Display modes | done | Onboarding slider+alt, Settings radio, provider+localStorage+PATCH, extra_simple styles |
| G10 Data model | done | migration applied in tests; profile/request/notification/upload_status/story link+status + RLS/Realtime |
| G11 Reliability | partial | idempotency keys, disable-pending, drafts in localStorage, in-app inbox+Realtime, short errors; server upload retry + delivery-retry still backend TODO |
| G12 MVP 14 | partial | static route pass done; full logged-in listener→storyteller→playback e2e needs real auth session + hosted DB |

## Next
- Apply `supabase/migrations/20261025000000_brief_gap.sql` to hosted project (dashboard SQL or supabase db push), verify tables/RLS/Realtime/advisors
- Logged-in Playwright e2e: capture → review → archive → choose → confirm → accept → record → publish → playback × 3 display modes; file bugs back to Phase 3
- Backend follow-ups: story draft endpoint, story_ready notification on compose_story, upload_status transitions, request→interview link

## Navigation polish (2026-10-25)
- New `components/ui/Nav.tsx`: BottomNav (Home/Stories/Requests/Alerts/Family + unread badge, hidden on focused flow screens), Loading, EmptyState, ErrorBanner
- ScreenHeader (Back + Home) added to Shelf, Heirloom, Interview (compact), Family; PublicStory gets Home link
- BottomNav added to Home, Stories, Requests, Alerts, Family, Settings; flow screens keep Back/Home header only. tsc + build clean.

## Person search + request flow (2026-10-25)
- Send: ChooseStoryteller → POST /api/requests (idempotent) → pending + request_received notification → RequestConfirm. Receive: Notifications inbox → RequestDetail → Accept (pending→in_progress) / decline (→declined + notify listener) / Tell the story → real interview with request_id → compose_story completes request + story_ready notification.
- New GET /api/families/{family_id}/people/search?q=&limit= (0–5 results): text rank exact→prefix→contains→full-name→relation, tiebreak by relationship degree (social-graph relevance), then name. Person now carries full_name + degree.
- ChooseStoryteller is search-first (250ms debounce, "Top N matches — pick by full name", empty→invite). 42 backend tests pass (incl. ranking/limit test), tsc + lint clean.

## Strict member add + stories feed (2026-10-25)
- Family tab no longer invents names: member search over registered accounts only (min 2 chars, max 5, excludes current members, 403 for outsiders), add validates caller-membership → family exists → account exists → not duplicate (409) → has display name (400). 46 backend tests pass.
- New GET /api/families/{family_id}/stories feed (latest story per object, newest first, cover + storyteller, limit ≤50); Shelf has Stories/Objects tabs with 60s staleTime. tsc + lint + build clean.

## Per-user Family, story tabs, audio fix, haptics (2026-10-25)
- Family is personal now: "Your family, {firstName}" header, member count, You badge on your row, roster split into Family / Friends (relation_label). Add flow picks Family/Friend; any row can be retagged (PATCH /people/{id}, strict family|friend allowlist). New GET /families/{id}/membership identifies the viewer.
- Shelf has exactly two tabs: Your stories (storyteller = you) and Family stories (everyone + per-member archive chips with counts). New feed filter ?storyteller_id= and GET /families/{id}/storytellers. Untold objects listed under Family stories.
- Story audio: fixed the tap-to-play race (seek-before-metadata failed silently on mobile) — the player now waits for loadedmetadata with a timeout, shows "Playing: …", and surfaces a retry message instead of silence. Recordings were being stored correctly; playback was the break.
- Haptics: lib/haptics.ts (navigator.vibrate, no-op on iPhone Safari) wired to Interview Answer/Done and Capture video Capture/Stop.
- 50 backend tests pass (membership/retag/archives/filter), tsc + lint + build clean.

## Immersive world per story-photo, fixed + enabled (2026-10-26)
- Found the full World Labs flow already built but dark: IMMERSIVE_ENABLED unset (default False → all routes 404). Per user answers: kept per-photo design, added story reference only.
- New migration 20261027000000_immersive_story_ref.sql: immersive_world.story_id → story(id) ON DELETE SET NULL + index + backfill to latest version per heirloom.
- Router create_world pins latest story version at request time and re-pins on retry; GET world exposes story_id. Semantics/assets/family+public access unchanged (RLS members-read + public link for ready worlds).
- backend/.env: IMMERSIVE_ENABLED=true, WORLDLABS_MODEL=marble-1.0-draft (~$0.18/world; cap 5/family/day). Fixed a no-trailing-newline glue that corrupted the edit; settings verified loading.
- 80 backend tests pass (incl. 2 new: pins latest story, re-pins on retry, null when no story); api-types regenerated; tsc + vite build clean. Pre-existing ruff failures in teammate's storytime/provider files left untouched.
- Still needed on hosted project: apply 20261025300000 + 20261027000000 migrations and set IMMERSIVE_ENABLED + WORLDLABS_MODEL + WORLDLABS_API_KEY there.

## Interview latency, spoken loop, object fingerprints (2026-10-25)
- next_question writes only the question text at minimal effort via providers.fast; coverage moves to a background update_coverage job; one-query context load; the streaming answer drafts the question on each 0.6 s pause and returns it on the same socket. Hard cap of 10 questions, WRAP_UP lets the model end sooner. Live e2e: next question 1.3–2.7 s after the answer ends (was 3.9–6.3 s).
- Interview.tsx is a hands-free loop: speak question (phone TTS) → record → silence detection (2 s after speech) → streamed STT → next question, with I'm done / Hear again / End interview and "Question n of 10".
- Matching: heirloom.signature (one line of lasting features from analyze_object) + generated tsvector + GIN index (20261025200000_heirloom_signature.sql, applied to hosted, 9/9 backfilled). find_matches is one 80 ms query that prefilters by same category or shared signature words, then the fast model at minimal effort (0.7–1.3 s). No candidates means no model call.
- 60 backend tests pass, ruff clean, tsc + lint + build clean.
