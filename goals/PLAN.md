# Logical Plan — Brief §8 order, adapted to existing base

## Principle
Build on working pipeline (stages 1–8, interview) — add missing request/notification/prefs layer, then UX. Pydantic → OpenAPI → api-types is the contract chain. Every new table gets RLS + Realtime + backend enforcement.

## Step 0 — Types refresh baseline
- `cd backend && uv run python -c "import json; from app.main import app; print(json.dumps(app.openapi()))"` → frontend openapi (already in `make types`)

## Step 1 — Data (BE-1, no frontend overlap)
File: `supabase/migrations/20261025000000_brief_gap.sql`
- `profile`: `user_id PK (auth.users), display_name, age int, ui_mode text check (regular/simplified/extra_simple), avatar_media_id uuid, created_at` — backs Brief User age/ui_mode + onboarding + Settings
- `story_request`: `id, heirloom_id→heirloom, capture_media_id→media, listener_id→person, storyteller_id→person, message text, status check (pending/in_progress/completed/declined/cancelled) default pending, idempotency_key text unique nullable, created_at`
- `notification`: `id, recipient_id→person, type check (request_received/request_declined/story_ready/memory_added), request_id→story_request nullable, story_id→story nullable, read_at nullable, created_at`
- `media.upload_status text check (uploading/ready/failed) default ready` + `duration_ms` already exists
- `story`: add `request_id→story_request nullable, storyteller_id→person nullable, recording_media_id→media nullable, status check (draft/published) default published` (keep versioned published rows; drafts live in story_request? No — separate `story_draft`? Simpler: allow status=draft rows, latest published wins)
- RLS: members-read SELECT on profile/story_request/notification (via heirloom_family / recipient membership); grants SELECT to authenticated
- Realtime: `alter publication supabase_realtime add table story_request, notification, media, heirloom, profile`
- Backfill: profiles for existing members (trigger or insert in migration from member+person)

## Step 2 — API (BE-1 + BE-2)
- `backend/app/routers/requests.py` (prefix /api/requests):
  - `POST /api/requests` {heirloom_id, capture_media_id?, storyteller_id, message?, idempotency_key?} → creates pending, enqueues? No job; creates notification request_received. Duplicate idempotency_key → return existing (prevent double-tap).
  - `GET /api/requests?family_id=&role=mine|incoming|all` → list with heirloom cover, status
  - `GET /api/requests/{id}`, `POST /{id}/accept` (pending→in_progress), `POST /{id}/decline` {reason?} (→declined + notify listener), `POST /{id}/cancel` (→cancelled, listener only)
- `backend/app/routers/notifications.py`:
  - `GET /api/notifications` (mine, unread first), `POST /{id}/read`
  - Helper `create_notification(conn, recipient_person_id, type, request_id?, story_id?)` used by requests + compose_story (story_ready) + memories
- `backend/app/routers/profiles.py` (or extend families.py):
  - `GET /api/profile`, `PATCH /api/profile` {display_name?, age?, ui_mode?} — age sets default ui_mode unless explicitly overridden (<18 regular, 18–50 simplified, >50 extra_simple per brief)
- Extend `stories.py`: include request_id/storyteller/status; `POST /api/stories/{heirloom_id}/draft` save draft; publish links request→completed + notify story_ready
- Extend `heirlooms.py`: `GET /api/heirlooms/search?family_id=` stub for archive search (manual match fallback, clearly labeled DEMO until AI matching); `POST /photos/complete` sets upload_status ready/failed
- Wire in `main.py`; add tests `backend/tests/test_requests.py` (CRUD, transitions, idempotency, RLS denial, notification fan-out)

## Step 3 — UI shell (FE-1)
- `frontend/src/lib/displayMode.tsx`: context {mode, setMode, age} persisted to profile + localStorage fallback; `useDisplayMode()`, `MODE` styles (text sizes, one-action layout for extra_simple)
- `frontend/src/routes/Onboarding.tsx`: age slider + numeric/± alt, "Use simpler screens" offer, saves profile
- `frontend/src/routes/Home.tsx` (replace Shelf at `/`, keep Shelf as Family stories tab): heading "Discover an object's story", big Open camera, cards: Family stories / My requests / Tell a story / Notifications (unread badge)
- `frontend/src/routes/Settings.tsx`: Display mode radio (Regular/Simplified/Extra simple), age edit, sign out
- Update `main.tsx` routes: `/` Home, `/stories` (Shelf), `/requests`, `/requests/:id`, `/notifications`, `/settings`, `/onboarding`, `/capture`, `/review`, `/archive`, `/choose/:heirloomId`, `/request-confirm/:id`, `/tell` (storyteller record without request), `/answer/:requestId` (storyteller flow)

## Step 4 — Listener flow (FE-1)
- `Capture.tsx` v2: photo/video tabs (default photo), live preview + square frame + "Place the object inside the frame", Capture/Stop, Switch camera (facingMode toggle), Upload instead, Back; permission error states; 60s timer + indicator (MediaRecorder for video)
- `Review.tsx`: preview photo / video+audio, "Can you see the object clearly?", Retake / Use photo-video; blur/low-light heuristic (file size + luminance sample) with "This looks a little blurry…" + allow continue
- `Archive.tsx`: after approve → upload (progress bar + retry) → save media (upload_status) → "Looking for this object's story…" → states: 1 match (Is this same object?), N matches + None of these, pending → status, no match → create, failed → Try again / Request anyway (manual matching labeled DEMO)
- `ChooseStoryteller.tsx`: "Who might know its story?" large cards (photo+name), select → preview + message box (placeholder "Grandpa, who gave you this watch?") + Send request (idempotency key) → navigate confirm
- `RequestConfirm.tsx`: "Story requested" + "We've asked X…" + Back home / View request
- `MyRequests.tsx`: pending + completed lists, status chips, tap → detail; decline → choose another

## Step 5 — Storyteller + playback (FE-2)
- `IncomingRequest.tsx` (`/requests/:id`): "X wants to hear about your Y", large image/capture, message, Tell the story / Later / I don't know this story
- `RecordStory.tsx` (`/answer/:requestId` + `/tell`): default audio, video toggle; "Tell us about this object"; image + Start + timer + pause/resume + Finish; follow-ups one-at-a-time (Who gave it to you? / When did you get it? / What makes it special?) with Answer/Skip
- `ReviewShare.tsx`: playback, editable title + 1–2 sentence description + dates/people/place; Share story / Record again / Save draft; share → published + request completed + notify; success "Your story has been shared with X"
- `StoryView.tsx` upgrades: render photo/people/memory blocks (not null), storyteller name, captions/transcript, Ask a follow-up button, AI summary kept separate + approved label

## Step 6 — Reliability + polish
- Idempotency keys on request + story publish; disable buttons while pending
- Upload progress (XHR) + retry; preserve capture/review state in sessionStorage on navigate
- In-app notifications polling via Realtime `notification` table; unread badges
- Short errors + next action everywhere; DEMO labels on manual matching
- All screens render in 3 modes (shared `<BigButton>`, `<ScreenHeader Back Home>`, Read more collapse)

## Step 7 — Verification (Phase 4)
- `make lint`, backend tests with DB, `make types` regen
- Playwright: boot both servers, snapshot every route × 3 modes, run full listener→storyteller→playback script, capture console/network, update PROGRESS.md G1–G12 + MVP 14
