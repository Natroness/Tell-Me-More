<img width="1312" height="1199" alt="image" src="https://github.com/user-attachments/assets/537daf5a-ac4b-4f53-bf6f-33924a3db619" />
# Tell Me More

Photograph a family heirloom, let a relative tell its story in their own voice, and get a cited story page the whole family can explore. English only: interviews, stories, narration, and captions. Built for HackTX 2026 (Meta track). Design: [docs/DESIGN.md](docs/DESIGN.md).

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

- Pipeline stages live in `backend/app/jobs/stages/<stage>.py`. The core stages (object analysis through cited story and cover art) are implemented and tested. Optional Immersive and Storytime stages use the separate slow worker lane.
- Tests in `backend/tests/` use fake providers from `conftest.py`, so they run without API keys.
- Model calls go through `app/providers` only. Switch Muse and Gemini with `LLM_PROVIDER` / `VISION_PROVIDER`.
- Prompts live in `backend/app/prompts/*.md`.

## Storytime videos

English-only Storytime is an opt-in slideshow made after a published story exists. It uses
Muse for a cited script and illustrations, a fixed Gemini narrator, original storyteller audio,
and optional Pixabay photos. Progress and native MP4 playback appear on member and public story pages.

1. Apply the new `supabase/migrations/20261026000000_storytime.sql` migration after earlier migrations.
2. Install **FFmpeg and ffprobe with libass** on the backend worker (for example,
   `sudo apt-get install ffmpeg fonts-dejavu-core` on Ubuntu). Both must be on `PATH`.
3. Set `GEMINI_API_KEY`; optionally set `PIXABAY_API_KEY` for stock. The existing Meta and Supabase
   credentials are reused. Defaults: `TTS_MODEL=gemini-3.8-flash-tts`, `TTS_VOICE=Sulafat`.
4. Run `cd backend && uv run python -m scripts.check_services --storytime-only` to check media tools,
   make one short English narration request, and search Pixabay. `make check` checks media tools too;
   `--storytime` adds provider probes to the complete service check.
5. Set `STORYTIME_ENABLED=true` and restart the backend when ready. It defaults to false.
   The storyteller or family owner can then choose Create on the story page. Each family gets
   five explicit generation requests per rolling 24 hours by default. Removing a video does not reset that cap.

Videos use private storage and signed playback URLs. Regeneration retains the previous video until
its replacement succeeds. The shared slow lane bounds jobs, and one encoder at a time uses two threads.
Original synthesized music and its CC0 notice live in `backend/app/assets/music/`.
Implementation checklist and verification: [docs/STORYTIME_TODO.md](docs/STORYTIME_TODO.md).
