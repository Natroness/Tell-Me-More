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
