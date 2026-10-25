<div align="center">

<img width="1312" alt="Tell Me More" src="https://github.com/user-attachments/assets/537daf5a-ac4b-4f53-bf6f-33924a3db619" />

# Tell Me More

**Families don't lose heirlooms. They lose what the heirlooms mean.**

Photograph a family object, let a relative tell its story in their own voice, and get a living page<br/>
the whole family can explore, where every sentence links back to who said it.

[Devpost](https://devpost.com/software/tell-me-again) · [Design doc](docs/DESIGN.md) · [Immersive Memories](docs/IMMERSIVE.md) · [Storytime](docs/STORYTIME.md)

Built at **HackTX 2026** for the **Meta: Bringing People Closer Together** track

</div>

---

## The idea

Every family has a drawer of things nobody can explain anymore: a watch with an engraving, a ring that was resized twice, a photo of a street that looks different now. Usually the person who knows the story is still around. Nobody has asked them yet.

Tell Me More makes that conversation easy to start and worth keeping. It is built on one rule:

> **The AI helps people remember. It never speaks for the person remembering.**

The relative's original audio is the source of truth. Every generated sentence cites it, and we never clone or imitate their voice.

## How it works

```
 Capture ──► Read the object ──► Interview ──► Story page ──► Family adds on
 (photo)     (Muse vision +       (voice, AI     (cited          (memories,
              Google Lens)         follow-ups)    narrative,      reactions,
                                                  audio, era)     share)
```

| | Step | What happens |
|---|---|---|
| 📷 | **Capture** | Photograph the heirloom on a phone. |
| 🔍 | **Read the object** | Muse Spark finds engravings, wear and repairs. SerpApi Google Lens dates the style and era. Each detail becomes a gentle question. |
| 🎙️ | **Interview** | One large question at a time. The relative talks, Muse Voice Transcribe records it with timestamps, and Muse Spark picks a follow-up based on what they just said. |
| 📖 | **Story page** | Cover art, narrative, pull quotes, timeline, people, places and era cards. Every sentence is tagged *their words*, *what the photo shows*, *verified history* or *AI bridge text*. Tap one of their sentences to hear them say it. |
| 👨‍👩‍👧 | **Family adds on** | Share the link. An uncle records his own memory, and the story regenerates with his part woven in, credited to him. |

### Beyond the core loop

- **Immersive Memories.** World Labs turns the place in a story into a walkable 3D world. Spots in the world play the narrator's original audio clips.
- **Storytime videos.** A 30 to 75 second slideshow with family photos, illustrations and period photos. A clearly labeled AI narrator speaks in the third person and pauses for the storyteller's real voice.
- **Family tree, requests and scheduling.** Place relatives in a tree, ask a specific person about a specific object, and find a time when you're both free to call.

## Built with

| Layer | Tools |
|---|---|
| **AI** | Meta Muse Spark (vision, interview, story writing), Muse Voice Transcribe, Muse Image, World Labs Marble, Gemini TTS (Storytime narrator only) |
| **Search** | SerpApi: Google Lens, Google Search, Google News, plus Pixabay |
| **Frontend** | Vite, React, TypeScript, Tailwind, three.js with a Gaussian splat renderer (lazy-loaded) |
| **Backend** | FastAPI on Python 3.12, uv, Pydantic v2, a Postgres-backed job worker, FFmpeg |
| **Data** | Supabase Postgres, Auth, Storage and Realtime, with row-level security on every table |

## Architecture

```
Phone browser ──REST──► FastAPI ──► Muse · World Labs · SerpApi · Gemini
      ▲                    │
      └──── Realtime ◄── Supabase (Postgres + Storage + Auth)
```

- **Provenance on every claim.** Each sentence in a story cites `fact` ids, and each fact points to a transcript `segment` (with millisecond timestamps), a photo observation or a search result. A validator rejects any sentence that cites something that doesn't exist.
- **No server push.** The backend only writes rows. The browser subscribes through Supabase Realtime, so the interview screen updates live without any streaming code on the server.
- **The interview never waits on slow work.** World generation (about 5 minutes) and video rendering run in a separate worker lane, and no job holds a database connection while it waits on an external API.
- **Interview speed.** Question generation runs Muse Spark at `reasoning_effort=minimal`, which takes about 3 s instead of about 15 s at the default, with the same question quality.

Full details: [docs/DESIGN.md](docs/DESIGN.md).

## Getting started

### Prerequisites

Node with pnpm, Python 3.12 with [uv](https://docs.astral.sh/uv/), Docker (for tests), and a Supabase project.

### First-time setup

1. Create a Supabase project. Run `supabase/migrations/20261024000000_init.sql` in the SQL editor (or `supabase db push`).
2. In Supabase Auth settings, add `http://localhost:5173` and your tunnel URL to the redirect URLs.
3. Copy the env files and fill in keys:
   ```bash
   cp backend/.env.example backend/.env && cp frontend/.env.example frontend/.env.local
   ```
4. Install dependencies:
   ```bash
   (cd backend && uv sync) && (cd frontend && pnpm install)
   ```

### Daily dev

```bash
make dev-backend    # FastAPI on :8000 with reload
make dev-frontend   # Vite on :5173, proxies /api to :8000
make tunnel         # HTTPS URL for phones (camera and mic need it)
make types          # after changing any Pydantic model or route
make lint
make test           # needs Docker running
make check          # live API checks with your real keys
```

<details>
<summary><b>Storytime videos setup</b></summary>

<br/>

Storytime is opt-in and English-only. It runs after a published story exists. Videos target **30 to 75 seconds** and include one excerpt of the storyteller's original voice.

1. Apply `supabase/migrations/20261026000000_storytime.sql` after the earlier migrations.
2. Install **FFmpeg and ffprobe with libass** on the backend worker. Both must be on `PATH`, or set `FFMPEG_BINARY` and `FFPROBE_BINARY` to absolute paths.
   - Ubuntu: `sudo apt-get install ffmpeg fonts-dejavu-core`
   - macOS: `brew install ffmpeg-full`. It's keg-only, so the binaries are usually at `/opt/homebrew/opt/ffmpeg-full/bin/` on Apple Silicon.
3. Set `GEMINI_API_KEY`, and optionally `PIXABAY_API_KEY` for stock photos. Defaults: `TTS_MODEL=gemini-3.8-flash-tts`, `TTS_VOICE=Sulafat`.
4. Check the setup:
   ```bash
   cd backend && uv run python -m scripts.check_services --storytime-only
   ```
5. Set `STORYTIME_ENABLED=true` and restart the backend.

Each family gets five generation requests per rolling 24 hours. Videos use private storage and signed playback URLs, and regenerating keeps the previous video until the new one succeeds. Original music and its CC0 notice live in `backend/app/assets/music/`. Checklist: [docs/STORYTIME_TODO.md](docs/STORYTIME_TODO.md).

</details>

<details>
<summary><b>Immersive Memories setup</b></summary>

<br/>

Set `WORLDLABS_API_KEY` (a World API key from platform.worldlabs.ai). Worlds are opt-in per photo, capped per family per day, and run in the slow worker lane. Use `marble-1.0-draft` for development. Spec: [docs/IMMERSIVE.md](docs/IMMERSIVE.md).

</details>

### Tests

- Backend tests in `backend/tests/` use fake providers from `conftest.py`, so they run without API keys.
- Browser checks for desktop and mobile:
  ```bash
  pnpm --dir frontend exec playwright install chromium --only-shell
  pnpm --dir frontend test:ui
  ```
  They use synthetic sessions and mocked services on port 4175, and leave the running app and hosted records alone. See [docs/FRONTEND_INTEGRATION.md](docs/FRONTEND_INTEGRATION.md).

## Project layout

```
frontend/              Vite + React + TS. src/api-types.ts is generated, never hand-edited.
backend/app/
  jobs/stages/         one module per pipeline stage
  providers/           every model call goes through here (switch with LLM_PROVIDER / VISION_PROVIDER)
  prompts/             one .md prompt per stage
  routers/             FastAPI routes
supabase/migrations/   schema, RLS policies, Realtime publication, storage buckets
docs/                  design and feature specs
```

## What's next

- **Ask Muse about your family:** "What did Grandpa say about his watch?", answered with a link to his own recording.
- **More languages:** Nepali, Hindi, Spanish, Tagalog. v1 is English-only so the provenance guarantees stay solid.
- **Life lessons and traditions:** recipes, advice and rituals that aren't tied to an object.
- **Printed keepsakes:** a bound book with QR codes that play the original voices.

## Team

Built in 24 hours at HackTX 2026 by Anish KC, Nikesh Paudyal and team.

<div align="center">
<sub><i>"The AI helps people remember. It never replaces the person remembering."<i></sub>
</div>
