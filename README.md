<img width="1312" height="1199" alt="image" src="https://github.com/user-attachments/assets/537daf5a-ac4b-4f53-bf6f-33924a3db619" />
# Tell Me More

Photograph a family heirloom, let a relative tell its story in their own voice, and get a cited story page the whole family can explore. Built for HackTX 2026 (Meta track). Design: [docs/DESIGN.md](docs/DESIGN.md).

## Layout

- `frontend/` is Vite + React + TypeScript + Tailwind. API types in `src/api-types.ts` are generated, never hand-edited.
- `backend/` is FastAPI on Python 3.12, managed with uv. One process serves the API and runs the job worker.
- `supabase/migrations/` holds the schema, RLS policies, Realtime publication and storage buckets.

## First-time setup

1. Create a Supabase project. Run `supabase/migrations/20261024000000_init.sql` in the SQL editor (or `supabase db push`).
2. In Supabase Auth settings, add `http://localhost:5173` and your tunnel URL to the redirect URLs.
3. `cp backend/.env.example backend/.env` and `cp frontend/.env.example frontend/.env.local`, then fill in keys.
4. `cd backend && uv sync`, then `cd frontend && pnpm install`.

## Daily dev

```bash
make dev-backend    # FastAPI on :8000 with reload
make dev-frontend   # Vite on :5173, proxies /api to :8000
make tunnel         # HTTPS URL for phones (camera and mic need it)
make types          # after changing any Pydantic model or route
make lint
make test           # needs Docker running
make check          # live API checks with your real keys
```

## Where things go

- Pipeline stages live in `backend/app/jobs/stages/<stage>.py`. Stages 1 to 4 (`analyze_object`, `lens_lookup`, `transcribe_turn`, `next_question`) are implemented and tested. Stages 5 to 8 are stubs that raise `NotImplementedError`.
- Tests in `backend/tests/` use fake providers from `conftest.py`, so they run without API keys.
- Model calls go through `app/providers` only. Switch Muse and Gemini with `LLM_PROVIDER` / `VISION_PROVIDER`.
- Prompts live in `backend/app/prompts/*.md`.
