# Agents Loop Architecture — 4 Phases

One orchestrator (this session) + parallel workers via `Task` tool.
Single source of truth: `goals/GOALS.md`, `goals/PROGRESS.md`.

## Roles
- `explore`: fast codebase / docs lookup, no edits. Use for Phase 1.
- `general`: multi-step research + verification.
- `coder`: implements backend/frontend changes, runs lint/tests. Use for Phase 3.
- Orchestrator: owns goals, merges results, runs Playwright checks, updates PROGRESS.

## Loop
```
understand → plan → implement → review/test → (repeat until GOALS check)
```

### Phase 1 — Understand context
Workers (parallel):
1. backend-audit: routers/models/jobs vs Brief §6–7
2. frontend-audit: routes/components vs Brief §3–5
3. db-audit: migration vs Brief §6 states/transitions
Each returns: EXISTS / PARTIAL / MISSING + file:line evidence.

### Phase 2 — Logical plan
Sequenced (Brief §8 order):
1. Data: migration for story_request, notification, profile prefs, media upload_status, story status fields
2. API: requests, notifications, user-prefs/display-mode, archive-search/manual-match, drafts
3. UI: Home, Capture+Review, Archive search, Choose storyteller, Request confirm, My requests, Notifications, Storyteller record/review, Playback upgrades, DisplayMode + Settings + Onboarding
4. Reliability: idempotency, retries, resume, RLS/Realtime
Output: ordered file-by-file task list with API contracts (Pydantic → OpenAPI → api-types).

### Phase 3 — Implementation
Parallel `coder` lanes (no overlapping files):
- Lane BE-1: migration + requests + notifications routers + tests
- Lane BE-2: user prefs + archive search + story status transitions
- Lane FE-1: Home + Capture/Review + Archive + Choose storyteller + Request confirm
- Lane FE-2: My requests + Notifications + Storyteller flows + Playback + DisplayMode/Settings/Onboarding
Rules: Pydantic source of truth → `make types`; ruff + tsc; fake providers in tests; no secrets.

### Phase 4 — Review & testing
1. `make lint`, `make test` (Docker Postgres), `make check` (live, redacted)
2. Playwright (MCP `playwright` server, already connected):
   - Boot `make dev-backend` (:8000) + `make dev-frontend` (:5173)
   - Snapshot each route: `/`, `/capture`, `/h/:id`, `/interview/:id`, `/family`, new `/requests`, `/notifications`, `/settings`
   - Script: capture → review → archive → choose storyteller → confirm → storyteller accept → record → publish → playback
   - Record console messages + network failures; file bugs back to Phase 3
3. Update `goals/PROGRESS.md` with PASS/FAIL per G1–G12 + MVP 14.

## Iteration guardrails
- Exactly one `in_progress` todo; mark completed only after verification.
- New tables need RLS + Realtime + backend enforcement (never trust browser alone).
- New screens need all 3 display modes via shared components.
- Keep AI summary separate from primary recording; editable AI fields; never invent family facts.
- Preserve captures/drafts on navigate; block double-tap duplicates (idempotency keys).
