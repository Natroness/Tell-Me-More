# Lorebook: System and Low-Level Design

> Photograph a family object. Let a relative tell its story in their own voice. Lorebook turns that into a living page the whole family can explore, where every sentence links back to who said it.

Status: draft v0, HackTX 2026. Owner: team. Things marked **VERIFY** are assumptions to confirm with sponsor staff or docs before we build on them.

---

## 1. Track strategy

We optimize for **one** track and pick up cheap side prizes only where the integration is real.

| Track | Fit | Role in Lorebook | Decision |
|---|---|---|---|
| **Meta: Bringing People Closer Together** | Very high | Muse Spark runs the interview, object analysis, and story writing. Muse Voice Transcribe captures the relative's voice. Muse Image makes the cover art. A Muse connector lets people ask Muse about their family stories. | **Primary.** Every design choice is judged against it. |
| **SerpApi** | High, and real | Google Lens API identifies the object ("1950s Omega Seamaster"). Google Search and News APIs build the "What was the world like back then?" cards for each year and place in the story. | **Secondary.** It powers a feature we want anyway. |
| MLH .Tech domain | Free | `lorebook.tech` | Yes, costs 10 minutes. |
| MLH Gemini | Medium | Fallback LLM behind the same provider interface if Muse rate-limits or a modality is missing. | Only if we actually use it in the demo. |
| MLH Vultr | Low-medium | Host the API server. | Optional, decide at deploy time. |
| NMC2, Nessie, Toyota, Solana, Tiger, Snowflake | None | Off-theme. | Skip. Bolting these on dilutes the story for Meta judges. |

**Meta rubric mapping** (this is what the demo has to prove):

1. *Strengthens human connection.* The product exists to get a grandchild and grandparent talking, and to give the rest of the family a reason to add their own memories.
2. *AI is essential and well-integrated.* Without AI there is no interviewer, no follow-up questions, no object reading, no story, no cited history. Remove the AI and you have a voice memo app.
3. *Originality.* **Provenance-first storytelling.** Every sentence in the story is tagged as *their words*, *what the photo shows*, *verified history*, or *AI bridge text*, and you can tap any sentence to hear the original audio. Nobody else will have that.
4. *Working demo.* One end-to-end path, live, on a phone.

---

## 2. Product

### 2.1 Core loop (the demo)

```
 Capture ──► Read the object ──► Interview ──► Story page ──► Family adds on
 (photo)     (Muse vision +       (voice, AI     (cited          (memories,
              Google Lens)         follow-ups)    narrative,      reactions,
                                                  audio, era)     share)
```

1. **Capture.** Grandchild photographs Nani's ring on a phone.
2. **Read the object.** Muse Spark lists what it sees (engraving "R & S 1961", a resized band, a worn prong). Google Lens finds visual matches for the style and era. The app turns each detail into a gentle question.
3. **Interview ("Ask Nani").** The phone shows one large question at a time, optionally read aloud. Nani talks. The AI listens, transcribes, and picks the next question based on what she said and what is still unknown. 5 to 8 questions, about 5 minutes.
4. **Story page.** A generated mini-documentary: cover, polished narrative, pull quotes in her real voice, timeline, people, places, and era context cards. Every sentence carries a provenance chip.
5. **Family adds on.** An uncle opens the shared link, records his own 30-second memory of the ring, and it appears on the page attributed to him. The story regenerates with his piece woven in.

### 2.2 Scope tiers

| Tier | Features |
|---|---|
| **MVP (must demo)** | Photo capture. Object reading. Live voice interview with follow-ups. Transcript with timestamps. Cited story page with tap-to-play audio. Era context cards from SerpApi. Shareable link. |
| **Should** | Family members add their own memories (voice or text). Simple family roster (people with relationship to the narrator). Muse Image cover art. Language: narrator speaks Hindi/Spanish, story shown in English with the original audio kept. |
| **Stretch** | Muse connector ("Hey Muse, what did Grandpa say about his watch?"). Family tree view. "Life lessons" recordings. Traditions calendar. "Call Nani" scheduling that suggests a time you are both free. Share to Facebook. |
| **Cut** | Facebook Graph API data import (app review takes weeks). Voice cloning or AI narration of the relative's voice (violates our own core rule). Native mobile apps. |

**Rule that shapes everything:** the AI never speaks *as* the relative. Original audio is the source of truth. Generated text always cites it.

### 2.3 Demo script (3 minutes)

| Time | Beat |
|---|---|
| 0:00 | Pitch hook: "Families don't lose heirlooms. They lose what the heirlooms mean." |
| 0:30 | Photograph a real object on stage. Show detected details and suggested questions. |
| 1:00 | Teammate plays the grandparent. Two live interview turns, showing a follow-up that clearly reacts to the answer. |
| 1:45 | Switch to a pre-recorded, fully generated story (real relative if possible). Tap a sentence, her voice plays. Show the provenance chips and an era card with sources. |
| 2:30 | Second phone adds a memory as "Uncle". Page updates. |
| 2:50 | Close: "The AI helps people remember. It never replaces the person remembering." |

Pre-bake one complete story in case the venue Wi-Fi fails.

---

## 3. System architecture

### 3.1 Components

```
┌────────────────────── Phone browser (mobile web app) ───────────────┐
│ Vite + React + TypeScript + Tailwind + shadcn/ui                    │
│  • Camera capture (input capture=environment)                       │
│  • MediaRecorder → 16 kHz mono PCM via AudioWorklet                 │
│  • Interview screen rendered from interview.state                   │
│  • Story page renderer (blocks + citations + audio scrubbing)       │
│  • supabase-js: auth, direct uploads, Realtime subscriptions        │
└──────────┬───────────────────────────────┬──────────────────────────┘
           │ REST (JSON, Supabase JWT)     │ Realtime (row changes) + Storage uploads
           ▼                               ▼
┌──────────────── FastAPI (Python 3.12, uv) ─────┐   ┌──────────────────────┐
│  Routers: families, heirlooms, interviews,      │   │ Hosted Supabase      │
│  stories, memories                              │◄─►│  Postgres (+ job)    │
│                                                 │   │  Storage             │
│  Worker: asyncio loop inside the same process,  │   │  Auth (magic link)   │
│  claims rows from `job` (§5.1)                  │   │  Realtime            │
│                                                 │   └──────────────────────┘
│  Provider adapters (Protocol per capability)    │
│   • LLM: MetaModelApi (muse-spark) | Gemini     │
│   • ASR: MuseVoiceTranscribe | Whisper fallback │
│   • Image: MuseImage                            │
│   • Search: SerpApi (google_lens, google, news) │
└───────────────────────┬─────────────────────────┘
                        │ httpx / openai SDK / websockets
       ┌────────────────┼──────────────────┬──────────────────┐
       ▼                ▼                  ▼                  ▼
 Meta Model API    Muse Voice         SerpApi            Muse connector
 (OpenAI-SDK       Transcribe                            (stretch: tool
  compatible)                                             server on FastAPI)
```

The backend never pushes to the browser. It writes rows, and the browser subscribes to them with Supabase Realtime (new `turn`, `interview.state`, `job.status`, new `story` version, new `memory_note`). That removes all streaming code from FastAPI.

### 3.2 Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | **Vite + React + TypeScript**, React Router, TanStack Query | Mobile-first SPA. TanStack Query for REST calls and caching. |
| UI | Tailwind + shadcn/ui, Framer Motion | Framer Motion for the story page reveal. |
| Live updates | **Supabase Realtime** (postgres_changes) | Subscribe per interview / heirloom. Needs RLS select policies to deliver rows. |
| Backend | **FastAPI** on Python 3.12, uvicorn | One process: API routers plus the job worker. |
| Python tooling | **uv** (deps + lockfile), **ruff** (lint + format), **Pydantic v2** | `uv sync` gives every laptop the same environment. |
| Models / schemas | **Pydantic is the source of truth.** TS types for the frontend are generated from FastAPI's OpenAPI spec with `openapi-typescript`. | One `make types` command after a schema change. |
| DB access | `asyncpg` (or SQLAlchemy 2 async) against Supabase Postgres, SQL migrations in `supabase/migrations/` | Backend connects as the database owner and uses the `sb_secret_` key for Storage, and enforces membership in code. Browser reads go through RLS. |
| Storage | Supabase Storage, buckets `photos`, `audio`, `generated` | Browser uploads directly with signed upload URLs from FastAPI. |
| Auth | Supabase Auth magic link | FastAPI verifies the Supabase JWT on every request (`Authorization: Bearer`). |
| Jobs | **Postgres `job` table + asyncio worker loop** | Claim with `select ... for update skip locked`. Retries up to 3, then `failed`. |
| LLM client | `openai` Python SDK with `base_url` set to Meta Model API; `google-genai` for Gemini fallback | Same adapter interface for both. |
| HTTP | `httpx` (SerpApi, ASR batch), `websockets` (ASR realtime if needed) | |
| Deploy (demo copy) | **Vultr VM**: uvicorn behind Caddy (auto HTTPS on `lorebook.tech`), Caddy also serves the Vite `dist/` build | Single box, single domain, no CORS in production. Counts for MLH Vultr. |

### 3.2.1 Local-first development

We build from laptops first and deploy a demo copy to Vultr around hour 18 to 20.

| Concern | Local setup |
|---|---|
| Frontend | `pnpm dev` (Vite on :5173). Vite proxies `/api` to FastAPI, so there's no CORS in dev either. |
| Backend | `uv run uvicorn app.main:app --reload --port 8000`. The worker loop starts in FastAPI's lifespan hook. |
| Database + storage + auth | Hosted Supabase project shared by the team. Same setup locally and deployed, and SerpApi Lens can fetch signed photo URLs. |
| Phone access | Phones need HTTPS for camera and mic (`getUserMedia` only works in a secure context). Run `cloudflared tunnel --url http://localhost:5173` and open that URL on the phone. Add the tunnel host to Vite's `server.allowedHosts`. |
| Secrets | `backend/.env` (gitignored): `META_API_KEY`, `SERPAPI_KEY`, `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWT_SECRET`, `DATABASE_URL`. `frontend/.env.local`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`. |
| Demo day | Demo from the Vultr URL. Laptop plus tunnel is the backup. Pre-generated story is the last resort. |

### 3.2.2 Repo layout

```
lorebook/
├── frontend/                 Vite + React + TS
│   ├── src/
│   │   ├── routes/           shelf, capture, interview, story, family
│   │   ├── components/       ui/ (shadcn), story/ (block renderers), audio/
│   │   ├── lib/              supabase.ts, api.ts (typed client), recorder.ts
│   │   └── api-types.ts      generated from OpenAPI, never hand-edited
│   └── public/worklets/pcm16k.js
├── backend/
│   ├── pyproject.toml        uv-managed
│   └── app/
│       ├── main.py           FastAPI app, lifespan starts worker
│       ├── auth.py           Supabase JWT → user, family membership checks
│       ├── db.py             asyncpg pool, queries
│       ├── models.py         Pydantic: Source, Citation, StoryBlock, Coverage ...
│       ├── routers/          families.py, heirlooms.py, interviews.py, stories.py, memories.py
│       ├── jobs/             runner.py + one module per stage (§5.1)
│       ├── providers/        base.py (Protocols), meta.py, gemini.py, serpapi.py
│       └── prompts/          one .md per stage
├── supabase/migrations/      SQL schema + RLS
└── docs/DESIGN.md
```

### 3.3 External APIs and what we call

| Need | API | Call | VERIFY |
|---|---|---|---|
| Object reading, follow-up questions, story writing, era summaries | Meta Model API, `muse-spark-1.x` | Chat completions with structured output (JSON schema) | Does Muse Spark accept image input? If not, use Gemini for the vision step only. Current model id (1.1 vs 1.2). |
| Transcription | Muse Voice Transcribe, `muse-voice-transcribe-1.0` | Sources disagree: realtime WebSocket vs batch upload of 16 kHz mono WAV up to 10 min. Design supports both (§5.3). | Exact endpoint, whether it returns segment timestamps, language support. |
| Cover art | Muse Image | `images/generations` with a prompt built from the story | Endpoint path and response format. |
| Object identification | SerpApi `engine=google_lens` | `url=<signed photo URL>` → `visual_matches[]` | Signed URL must be publicly fetchable for ~5 min. |
| Era context | SerpApi `engine=google` (+ `google_news` for old archive hits) | Queries per (year, place, topic) | Free tier quota. Cache aggressively. |
| Places (should) | SerpApi `engine=google_maps` | Resolve "the bazaar in Lahore" to a pin | |
| Muse connector (stretch) | Meta connector format | Expose `search_family_stories`, `get_story`, `add_memory` | Ask Meta staff what format Muse connectors use. |

### 3.4 Verified against live APIs (2026-10-24, `make check`)

| Service | Result | Latency seen |
|---|---|---|
| Muse Spark chat, JSON schema output | Works (`muse-spark-1.3-contributor`) | 3 to 6 s |
| Muse Spark vision | **Works.** Images go as base64 data URLs. Gemini is not needed for stage 1. | 5 to 10 s |
| Muse Image | Works via OpenAI-style `images.generate` (`muse-image-1.0`) | 9 to 42 s |
| Muse Voice Transcribe | **Not OpenAI-compatible.** `POST https://api.meta.ai/v1/asr/transcribe`, multipart with a JSON `request` part (`mode`, `model`, `audioEncoding: "WAV"`, optional `languageBias`) and an `audio` part. `ENDPOINTING` mode returns `turns` with `startMs`/`endMs`. A turn can hold several sentences, so `transcribe_turn` splits it by sentence inside its span. 10-minute and 32 MB caps. | 3 s |
| Gemini fallback | Works, but `gemini-2.5-flash` is retired for new users. Use `gemini-3.8-flash`. | 5 to 49 s |
| SerpApi Google Lens | Works on a Supabase signed URL. About 60 matches for a pocket watch. | 22 s |
| Supabase Storage | Works with the `sb_secret_` key on `apikey`. Signed download URLs need no key. | 5 s |

Muse Spark is a reasoning model, and `reasoning_effort` defaults to `medium` (accepted: `minimal`, `low`, `medium`, `high`, `xhigh`, `max`; not `none`). At the default, `next_question` spent about 2,100 reasoning tokens to write about 120 visible ones, which took 15 s. At `minimal` it takes about 3 s, and the questions are just as good. `LLM.json(effort=...)` sets it per call. The live interview uses `minimal`, and the post-interview stages keep the default.

Muse Voice Transcribe takes a `keywords` list in the request. `transcribe_turn` passes the family's names, so "Hari" is no longer heard as "Harry".

Interview loop, measured end to end (`scripts/e2e_pipeline.py`, 2026-10-24): about 9 s from answer upload to the next question, down from 21 s. That breaks down as `transcribe_turn` 4 to 5 s (ASR call plus a storage download), `next_question` about 3.5 s, and worker polling about 0.5 s. Streaming ASR then removed the transcription wait: the transcript is saved about 0.8 s after Done (0.15 s ASR final plus the database writes). The next question is ready 3.9 to 6.3 s after Done, almost all of it `next_question` at minimal effort.

Supabase's session pooler caps clients per project (15 here). The asyncpg pool opens connections on demand and holds at most `DB_POOL_SIZE` (default 5), so the API, the worker and a dev script fit together.

Network gotcha: some venue and campus networks block outbound ports 5432 and 6543, so Postgres can't connect even with correct credentials. Use a phone hotspot for development, and the Vultr box for the demo.

---

## 4. Data model

### 4.1 Core idea: provenance on every claim

Every piece of information in Lorebook is a `fact` with a `source`. The story is a list of blocks, and each sentence points at the facts and transcript segments it came from. This one structure gives us the trust story, tap-to-play audio, and the clean split between memory and history.

```python
# backend/app/models.py. The four kinds of truth, kept apart forever.
class MemorySource(BaseModel):          # they said it
    kind: Literal["memory"]
    segment_ids: list[UUID] = Field(min_length=1)
    narrator_id: UUID

class ObservationSource(BaseModel):     # the photo shows it
    kind: Literal["observation"]
    media_id: UUID
    bbox: BBox | None = None
    via: Literal["vision", "lens"]

class HistorySource(BaseModel):         # a cited web source
    kind: Literal["history"]
    url: HttpUrl
    title: str
    retrieved_at: datetime

class InferenceSource(BaseModel):       # AI connecting dots, shown as such
    kind: Literal["inference"]
    based_on: list[UUID]

Source = Annotated[
    MemorySource | ObservationSource | HistorySource | InferenceSource,
    Field(discriminator="kind"),
]
```

UI color per kind: memory = warm amber, observation = slate, history = blue with a link icon, inference = dotted gray and labeled "Lorebook's note".

### 4.2 Tables (Postgres)

```sql
-- Families and people -------------------------------------------------------
create table family (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text unique not null,          -- share link joins the family
  created_at timestamptz default now()
);

create table person (                         -- anyone in the family, app user or not
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references family(id) on delete cascade,
  display_name text not null,                  -- "Nani", "Uncle Raj"
  full_name text,
  birth_year int,
  is_living boolean default true,
  avatar_media_id uuid,
  created_at timestamptz default now()
);

create table relationship (                   -- directed edges: a is <kind> of b
  family_id uuid not null references family(id) on delete cascade,
  a uuid not null references person(id) on delete cascade,
  b uuid not null references person(id) on delete cascade,
  kind text not null check (kind in ('parent','spouse','sibling')),
  primary key (a, b, kind)
);

create table member (                         -- app account ↔ person in a family
  user_id uuid not null,                       -- supabase auth.users.id
  family_id uuid not null references family(id) on delete cascade,
  person_id uuid references person(id),
  role text not null default 'member' check (role in ('owner','member')),
  primary key (user_id, family_id)
);

-- Heirlooms and media -------------------------------------------------------
create table heirloom (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references family(id) on delete cascade,
  title text,                                  -- AI suggests, user edits
  category text,                               -- jewelry | watch | letter | recipe | clothing | toy | photo | other
  cover_media_id uuid,
  created_by uuid not null,
  created_at timestamptz default now()
);

create table media (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references family(id) on delete cascade,
  heirloom_id uuid references heirloom(id) on delete cascade,
  kind text not null check (kind in ('photo','audio','scan','generated_image')),
  storage_path text not null,
  mime text not null,
  duration_ms int,                             -- audio only
  width int, height int,                       -- images only
  created_by uuid,
  created_at timestamptz default now()
);

-- Interview -----------------------------------------------------------------
create table interview (
  id uuid primary key default gen_random_uuid(),
  heirloom_id uuid not null references heirloom(id) on delete cascade,
  narrator_id uuid not null references person(id),
  interviewer_user_id uuid not null,
  language text default 'en',                  -- narrator's spoken language
  state text not null default 'ready',         -- see §5.2
  coverage jsonb not null default '{}',        -- slot → filled? (§5.2)
  created_at timestamptz default now(),
  ended_at timestamptz
);

create table turn (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references interview(id) on delete cascade,
  idx int not null,
  role text not null check (role in ('question','answer')),
  text text,                                   -- question text, or full answer transcript
  audio_media_id uuid references media(id),    -- answers only
  target_slot text,                            -- questions only: which gap it aims at
  unique (interview_id, idx)
);

create table segment (                        -- timed transcript pieces; citation target
  id uuid primary key default gen_random_uuid(),
  turn_id uuid not null references turn(id) on delete cascade,
  start_ms int not null,
  end_ms int not null,
  text text not null,                          -- original language
  text_en text                                 -- translation if language != en
);

-- Knowledge -----------------------------------------------------------------
create table fact (
  id uuid primary key default gen_random_uuid(),
  heirloom_id uuid not null references heirloom(id) on delete cascade,
  kind text not null check (kind in ('memory','observation','history','inference')),
  text text not null,                          -- "The ring was bought in Lahore in 1961"
  source jsonb not null,                       -- Source union, Pydantic-validated
  year int,                                    -- for the timeline, nullable
  place text,
  people uuid[] default '{}',
  confidence real,                             -- observations/inferences only
  created_at timestamptz default now()
);

create table context_card (                   -- "What was the world like back then?"
  id uuid primary key default gen_random_uuid(),
  heirloom_id uuid not null references heirloom(id) on delete cascade,
  year int not null,
  place text,
  topic text not null check (topic in ('events','music','fashion','prices','place')),
  summary text not null,
  sources jsonb not null                       -- [{url,title}], at least one
);

create table memory_note (                    -- another relative's addition
  id uuid primary key default gen_random_uuid(),
  heirloom_id uuid not null references heirloom(id) on delete cascade,
  author_id uuid not null references person(id),
  text text,
  audio_media_id uuid references media(id),
  created_at timestamptz default now()
);

-- Output --------------------------------------------------------------------
create table story (
  id uuid primary key default gen_random_uuid(),
  heirloom_id uuid not null references heirloom(id) on delete cascade,
  version int not null,
  title text not null,
  dek text,                                    -- one-line subtitle
  blocks jsonb not null,                       -- StoryBlock[] (§4.3)
  created_at timestamptz default now(),
  unique (heirloom_id, version)
);

-- Pipeline ------------------------------------------------------------------
create table job (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                          -- see §5.1
  subject_id uuid not null,                    -- heirloom or interview id
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  attempts int not null default 0,
  error text,
  output jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (kind, subject_id)                    -- idempotent enqueue
);
```

Row-level security: every table is readable and writable only by users with a `member` row for its `family_id` (via heirloom → family where needed). Story pages can also be opened by anyone holding the family's invite link, read-only.

### 4.3 Story blocks

```python
class SegmentCite(BaseModel):           # tap = play audio from start_ms
    kind: Literal["segment"]
    segment_id: UUID

class FactCite(BaseModel):
    kind: Literal["fact"]
    fact_id: UUID

Citation = Annotated[SegmentCite | FactCite, Field(discriminator="kind")]

class Sentence(BaseModel):
    text: str
    cites: list[Citation] = Field(min_length=1)   # no uncited sentences, ever

class Heading(BaseModel):   type: Literal["heading"];   text: str
class Paragraph(BaseModel): type: Literal["paragraph"]; sentences: list[Sentence]
class Quote(BaseModel):     type: Literal["quote"];     segment_id: UUID; speaker_id: UUID  # verbatim, plays audio
class Photo(BaseModel):     type: Literal["photo"];     media_id: UUID; caption: Sentence | None = None
class TimelineEvent(BaseModel): year: int; label: str; fact_id: UUID
class Timeline(BaseModel):  type: Literal["timeline"];  events: list[TimelineEvent]
class People(BaseModel):    type: Literal["people"];    person_ids: list[UUID]
class Context(BaseModel):   type: Literal["context"];   card_ids: list[UUID]
class Memory(BaseModel):    type: Literal["memory"];    memory_note_id: UUID   # a relative's addition

StoryBlock = Annotated[
    Heading | Paragraph | Quote | Photo | Timeline | People | Context | Memory,
    Field(discriminator="type"),
]
```

The frontend gets the matching TS discriminated union from the generated `api-types.ts`, and each `type` maps to one React block renderer.

`quote.text` is never stored. It is read from `segment.text` at render time, so a quote can't drift from what was said.

---

## 5. Low-level design

### 5.1 Pipeline stages

Each stage is a pure-ish function `(inputs from DB) → rows to write`, run as a `job`. Re-running a stage replaces its own output rows, so retries converge to the same state.

| # | Job kind | Trigger | Input | Output | Provider |
|---|---|---|---|---|---|
| 1 | `analyze_object` | photo uploaded | photo media | `fact(kind=observation)` × N, heirloom `title`/`category` suggestion, `seed_questions` in job output | Muse Spark vision (or Gemini) |
| 2 | `lens_lookup` | photo uploaded (parallel with 1) | signed photo URL | `fact(kind=observation, via=lens)` for top 3 confident matches | SerpApi Google Lens + Muse to summarize matches |
| 3 | `transcribe_turn` | answer audio uploaded | audio media | `turn.text`, `segment` rows, `text_en` if needed | Muse Voice Transcribe |
| 4 | `next_question` | stage 3 done, interview not ending | object facts, all turns, coverage | new `turn(role=question)`, updated `coverage` | Muse Spark |
| 5 | `extract_facts` | interview ended, or memory_note added | all segments + memory notes | `fact(kind=memory)` with segment citations, years, places, people | Muse Spark (structured) |
| 6 | `era_context` | stage 5 done | distinct (year, place) pairs from facts, max 3 | `context_card` rows | SerpApi Google/News → Muse summarize with source URLs |
| 7 | `compose_story` | stages 5 and 6 done | all facts, segments, cards, photos, memory notes | new `story` version | Muse Spark (structured) |
| 8 | `cover_art` | first story version | story title + object facts | `media(kind=generated_image)` | Muse Image |

Stages 1, 2 run while the interviewer is still on the capture screen. Stages 3, 4 must be fast (target under 4 seconds total) because a person is waiting. Stages 5 to 8 run after the interview with a "Writing Nani's story…" screen that updates live as `job` rows change (Supabase Realtime).

### 5.2 Interview state machine

```
ready ──start──► asking ──user taps "answer"──► listening
                   ▲                               │ stop / silence 2.5s
                   │                               ▼
                   └──── question ready ◄──── thinking (stages 3+4)
                                                   │ coverage complete or 8 answers
                                                   ▼ or user taps "finish"
                                               wrapping_up ──► done
```

The server owns `interview.state`. The client renders from it, so a page refresh mid-interview resumes where it was.

**Coverage slots** drive question choice so the interview feels purposeful rather than random:

```python
Slot = Literal[
    "origin",        # where did it come from, who first owned it
    "acquisition",   # how did you get it
    "moment",        # what was happening in your life then
    "people",        # who else is part of this story
    "sensory",       # a detail only someone who held it would know
    "secret",        # something nobody else knows
    "meaning",       # why it matters, what it stands for
    "legacy",        # who should have it next, what should they know
]
Coverage = dict[Slot, Literal["open", "partial", "filled"]]
```

`next_question` gets the coverage map and must return:

```python
class NextQuestion(BaseModel):
    updated_coverage: Coverage
    kind: Literal["follow_up", "new_slot", "wrap_up"]
    target_slot: Slot
    question: str = Field(max_length=140)   # one question, warm, plain words
    why: str                                # debug only, shown in dev panel
```

Policy, written into the prompt: prefer a `follow_up` when the last answer named a person, place, or feeling that wasn't explored. Otherwise go to the most important `open` slot. Never ask two questions at once. Never correct the narrator. If the narrator sounds upset, offer to skip.

### 5.3 Audio path

- Client opens an `AudioContext` at 16 kHz (the browser resamples the mic) and an `AudioWorklet` collects mono frames, encoded to 16-bit PCM WAV on stop, which is what Muse Voice Transcribe reportedly wants. See `frontend/src/lib/recorder.ts`.
- **Streaming (default):** while the narrator speaks, the phone streams 16-bit PCM over a WebSocket to `/api/interviews/{id}/answers/{turn}/stream` (`routers/answer_stream.py`). The backend relays it to Meta's realtime ASR (`wss://api.meta.ai/v1/asr/realtime`, `PUSH_TO_TALK`, family names as `keywords`) and sends partials back as live captions. On Done, the final transcript arrives in about 0.15 s. We save the turn text and segments, set `thinking`, enqueue `next_question`, reply `done`, and only then upload the WAV for story playback. Segment times come from the partials: the first partial that completes sentence k carries `audioProcessedMs`, which marks where sentence k ended (`segments.timed_segments`).
- **Batch (fallback):** if the socket fails, errors, or doesn't answer within 8 s, the phone uploads its own WAV and calls `/complete`, which runs `transcribe_turn`. Both paths end in `transcribe_turn.save_answer`.
- The 16 kHz WAV is both the ASR input and the playback file. At about 32 KB per second, a 2-minute answer is under 4 MB, so one file is simpler than two.
- If ASR returns no timestamps, fall back to one segment per sentence with timestamps estimated from character offsets. Tap-to-play still lands within a couple of seconds.

### 5.4 Story composition and validation

`compose_story` asks Muse Spark for `StoryBlock[]` via JSON schema. Then we validate at the boundary before saving:

1. Parse into `list[StoryBlock]` with Pydantic. Reject on shape errors.
2. Every `Sentence.cites` is non-empty, and every cited id exists for this heirloom.
3. A sentence citing only `inference` facts is allowed but must be rendered as "Lorebook's note".
4. Every `quote.segmentId` exists.
5. Years in the narrative must match a cited fact's `year`.

On failure, send the model the specific errors and retry once. On second failure, drop the offending sentences and save the rest. This is the mechanism behind the pitch line "keep the relative's memories separate from verified history so the AI doesn't invent family history."

### 5.5 Era context (SerpApi)

1. From memory facts, collect `(year, place)` pairs. Rank by how many facts reference them. Take the top 3.
2. For each, run 2 to 3 SerpApi queries, e.g. `"{place} {year}" events`, `popular music {year} {country}`, `cost of living {year} {country}`.
3. Pass organic results (title, snippet, link) to Muse Spark: "Write one 2-sentence card per topic using only these snippets. Return the URLs you used." Drop cards with no URL.
4. Cache SerpApi responses by query string in a `serp_cache` table to save quota and make demos repeatable.

### 5.6 API surface

FastAPI routers. All routes are JSON, require a Supabase JWT (`Authorization: Bearer`), and check family membership. Request and response bodies are Pydantic models, which also produce the OpenAPI spec the frontend types come from.

```
POST   /api/families                         { name } → { family, inviteCode }
POST   /api/families/join                    { inviteCode } → { family }
POST   /api/people                           { familyId, displayName, relation? } → person

POST   /api/heirlooms                        { familyId } → { heirloom, uploadUrl }
POST   /api/heirlooms/:id/photos/complete    { mediaId }  → enqueues analyze_object + lens_lookup
GET    /api/heirlooms/:id                    → heirloom + observations + seed questions + latest story

POST   /api/interviews                       { heirloomId, narratorId, language } → interview + first question
POST   /api/interviews/:id/answers           → { uploadUrl, turnId }
POST   /api/interviews/:id/answers/:turnId/complete   → enqueues transcribe_turn → next_question
POST   /api/interviews/:id/finish            → enqueues extract_facts → era_context → compose_story → cover_art

POST   /api/heirlooms/:id/memories           { authorId, text? , audio? } → enqueues extract_facts + compose_story
GET    /api/stories/:heirloomId              → latest story, resolved citations, signed audio URLs
GET    /api/public/stories/:heirloomId?k=<inviteCode>   read-only story for share links
```

Live updates are not an API route. The frontend subscribes with supabase-js:

| Channel filter | Drives |
|---|---|
| `interview` row `id=eq.<id>` | Interview screen state |
| `turn` rows `interview_id=eq.<id>` | New question appears, live transcript |
| `job` rows `subject_id=eq.<heirloomId>` | "Writing Nani's story…" progress |
| `story` rows `heirloom_id=eq.<id>` | Page refreshes when a new version lands |
| `memory_note` rows `heirloom_id=eq.<id>` | "Uncle just added a memory" toast |

### 5.7 Frontend routes (React Router)

| Route | Screen |
|---|---|
| `/` | Family shelf: grid of heirloom cards with cover art. |
| `/capture` | Camera, then "Here's what I notice" with detail chips on the photo and 3 seed questions. |
| `/interview/:id` | Full-screen, large type, one question, big record button, live caption, progress dots for coverage. Designed for an 80-year-old to read at arm's length. |
| `/h/:id` | Story page: cover, title, dek, narrative with provenance chips, sticky audio player, timeline, people, era cards, "Add your memory" button. |
| `/family` | Roster (and family tree in stretch). |
| `/s/:heirloomId?k=` | Public read-only story page for share links. |

### 5.8 Provider interface

```python
# backend/app/providers/base.py
class LLM(Protocol):
    async def json(self, *, system: str, messages: list[Msg], schema: type[T],
                   images: list[str] | None = None) -> T: ...

class ASR(Protocol):
    async def transcribe(self, *, audio_url: str, language: str | None = None) -> Transcript: ...

class ImageGen(Protocol):
    async def generate(self, prompt: str) -> bytes: ...

class Search(Protocol):
    async def lens(self, image_url: str) -> list[LensMatch]: ...
    async def web(self, q: str, engine: Literal["google", "google_news"] = "google") -> list[SerpResult]: ...
```

`LLM.json` passes `schema.model_json_schema()` as the response format and returns `schema.model_validate_json(...)`, so a bad model output fails right at the boundary. `providers/__init__.py` picks implementations from env (`LLM_PROVIDER=meta|gemini`). Pipeline code only sees these interfaces, so swapping Muse for Gemini on one stage is a config change.

### 5.9 Prompt sketches

**analyze_object (system):** You are helping a family preserve the story of an object. Describe only what is visible: materials, markings, engravings, wear, repairs, damage, style clues. For each detail give a short label, one sentence, an approximate bounding box, and your confidence. Do not guess who owned it. Then write 3 warm, specific questions a grandchild could ask a grandparent, each anchored to one detail.

**next_question (system):** You are a gentle oral-history interviewer talking with {narrator}, who is {relation} to the listener, about {object}. You will see what the object looks like, the conversation so far, and which parts of the story are still unknown. Ask exactly one short question in {language}. Follow up on names, places, and feelings they just mentioned before moving on. Never correct them. Never put words in their mouth.

**compose_story (system):** Write a short documentary-style story (300 to 500 words) about this object, for future grandchildren. Use only the facts and transcript segments provided, and cite their ids on every sentence. Use at least two verbatim quotes as quote blocks. Keep historical context in context blocks, never mixed into memory sentences. If you need a connecting sentence that no source supports, cite the inference fact you create for it.

---

## 6. Muse connector (stretch)

Expose Lorebook as a tool server Muse can call, so the family history becomes part of their everyday AI:

| Tool | Input | Output |
|---|---|---|
| `search_family_stories` | `query` | matching story snippets with heirloom links |
| `get_heirloom_story` | `heirloomId` | title, narrative text, quotes with audio links |
| `add_memory` | `heirloomId`, `text` | confirmation |

Demo line: "Hey Muse, what did Nani say about her wedding ring?" and Muse answers with her quote and a link to play it. **VERIFY** the connector format with Meta staff early on day one. If it's MCP, this is about 2 hours of work on top of existing routes.

---

## 7. Risks and checks

| Risk | Mitigation |
|---|---|
| Muse Spark lacks image input | Vision stage behind the `LLM` interface. Use Gemini for stage 1 only and say so in the pitch. |
| ASR API shape differs from docs | Adapter isolates it. Have a Whisper (OpenAI or local) fallback key ready. |
| Interview latency over 5 s feels broken | Show "listening…" animation, stream question text as it arrives, keep prompts small (send only last 4 turns plus coverage). |
| Hallucinated family history | Citation validator (§5.4). Provenance chips in the UI. |
| SerpApi quota | Cache table. Limit to 3 (year, place) pairs, 3 queries each. |
| Venue Wi-Fi | Pre-generated demo story. Hotspot. |
| Elders and privacy | Families are private by default. Share link is opt-in and read-only. Consent screen before recording ("This will be saved for your family"). |

**Day-one verification list** (one person, first 90 minutes):

1. Meta Model API key works. Send an image to Muse Spark. Note model id.
2. Muse Voice Transcribe: send a 20-second WAV. Check for timestamps and Hindi/Spanish support.
3. Muse Image: generate one image. Note endpoint.
4. SerpApi Google Lens on a signed Supabase URL.
5. Ask Meta staff about the connector format.

---

## 8. Build plan (about 30 hours, 4 people)

| Hours | A: Frontend | B: Interview + audio | C: Pipeline + AI | D: Data + SerpApi + pitch |
|---|---|---|---|---|
| 0–2 | Vite + React + Tailwind + shadcn scaffold, routes, supabase-js auth | Day-one API checks 1–3 | `uv` FastAPI scaffold, JWT auth, provider Protocols + Meta adapter | Supabase project, schema migration, RLS, buckets, check 4 |
| 2–8 | Capture screen + detail chips | Recorder + WAV worklet + upload | `analyze_object`, `transcribe_turn`, job runner | `lens_lookup`, serp cache |
| 8–14 | Interview screen from state machine | Realtime subscriptions, state machine on server | `next_question` + coverage | `era_context` |
| 14–20 | Story page renderer, citations, audio scrub | End-to-end interview test with a real grandparent call | `extract_facts`, `compose_story`, validator | Family roster, invite link, memory notes, Vultr VM + Caddy deploy |
| 20–26 | Polish, motion, mobile QA | Realtime captions (if time) | `cover_art`, Muse connector (stretch) | Deck, demo script, record backup story |
| 26–30 | Bug bash, freeze, rehearse ×3 | | | Devpost write-up, `lorebook.tech` |

Freeze features at hour 24. Everything after is polish and rehearsal.
