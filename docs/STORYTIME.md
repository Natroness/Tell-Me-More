# Feature Spec: Storytime Video (optional, made after a story exists)

> Hand-off brief for a coding agent working in the `HackTX` ("Tell Me More") repo, written against
> `main` @ `98a2b09`. Read `docs/DESIGN.md` (§2 rules, §4 data model, §5.1 pipeline),
> **`docs/IMMERSIVE.md` (sibling feature; this spec reuses its worker lane and rules)**,
> `backend/app/jobs/{queue,runner}.py`, `backend/app/providers/{base,meta,__init__}.py`,
> `backend/app/jobs/stages/{compose_story,cover_art}.py`, `backend/app/routers/stories.py`,
> `frontend/src/components/story/StoryView.tsx`, `frontend/src/lib/realtime.ts`.

## 1. What we're building

After a story exists, the storyteller can **opt in** to a "Storytime" video: a calm,
storyboard-style slideshow, 60–150 s long, that retells the story for family and friends. A
gentle AI **narrator** guides it, and it stops for short clips of **the storyteller's own recorded
voice**. The visuals mix:

- the family's **own photos** of the object (`media.kind = 'photo'`, already exposed as `Story.photos`),
- **Muse Image** illustrations (`providers.image`, the same path as `cover_art`),
- **stock photos** for era and place (a 1960s Kathmandu street, a train platform).

Slow Ken Burns pan/zoom, crossfades, quiet music, burned-in captions sized for older eyes. Anyone
who can open the story (family members, or the public story link) can watch it.

## 2. Non-negotiable rules

**English only.** Source interviews, scripts, original voice clips, generated narration, captions, and video text must all be in English. Translation and narration in other languages are out of scope.

1. **The AI never speaks as the relative** (DESIGN.md §2). The narrator speaks in the third person ("When
   Nani was nineteen…"). It uses one fixed narrator voice, never picked or tuned to sound like the
   storyteller. No voice cloning. Anything said in first person is the storyteller's **original audio clip**.
2. **Provenance.** The video opens with "Narrated by AI from {storyteller}'s own words". Every narrated
   line cites `segment` or `fact` ids, validated like `compose_story`. Never invent names, dates or places.
3. **Hot path is frozen.** Same list as IMMERSIVE.md §0.1: do not change `answer_stream.py`,
   `interviews.py`, `analyze_object` / `lens_lookup` / `transcribe_turn` / `next_question`,
   `recorder.ts`, the PCM worklet, `Capture.tsx`, or `Interview.tsx`. If you think one must change, stop and ask.
4. **Slow lane only.** Storytime jobs run in the slow worker lane (§5.1), never in the interview lane.
5. **No DB connection is held across a Muse, TTS, Pexels or ffmpeg call.** Acquire, read or write, release,
   then call out. The pool is `DB_POOL_SIZE=5` and the Supabase pooler caps at 15.
6. **Opt-in only.** No stage enqueues storytime. Only the explicit API call does. A feature flag guards it,
   with a per-family daily cap.

## 3. Open questions (resolve first, record in `docs/DESIGN.md` §3.4)

1. **Narrator TTS — resolved.** Use Gemini `gemini-3.8-flash-tts` with the fixed English `Sulafat`
   narrator and the existing `GEMINI_API_KEY`. The adapter passed a live narration probe.
2. **Stock images — resolved.** Use **Pixabay** (`PIXABAY_API_KEY`), with photographer/source credits
   and a 24-hour search cache. Pexels new-key issuance is paused. Do **not** use unverified SerpApi
   image results. Stock remains optional; unavailable stock falls back to an illustration.
3. **Music — resolved.** Four original synthesized CC0 ambient beds live in
   `backend/app/assets/music/`, with a reproducible generator and license notice.
4. **ffmpeg** must exist on the worker box (Vultr). Document it in the README and the Makefile `check` target.

## 4. User flow

1. The interview ends → `Interview.tsx` navigates to `/h/:heirloomId` (do not touch that file) →
   `compose_story` writes the story → `StoryView` renders it.
2. On the story page, **only the storyteller** (story `storyteller_id`, or the heirloom creator if that's
   null) **and the family owner** see a card: **"Make a Storytime video for the family?"** It has one line
   on what it is, "takes a few minutes, you can leave", and **Create**. Hide the card when
   `GET /api/storytime/available` is false.
3. Create → `POST /api/stories/{heirloom_id}/storytime`. The card becomes a progress chip driven by
   Realtime, with these steps: *Writing the script → Gathering pictures → Recording the narration →
   Putting it together*. Expect 2–5 min.
4. When it's ready, every viewer sees a **Storytime** player above the story. It's on `/h/:heirloomId` for
   members and `/s/:heirloomId` for the public link. A `storytime_ready` notification goes out (§5.4).
5. The storyteller or owner can **Regenerate** or **Remove** it. A newer story version marks the video
   `stale`: it stays playable, with a "Made from an earlier version" badge and a Regenerate prompt for
   the storyteller. It doesn't regenerate automatically.

## 5. Backend

### 5.1 Worker lane (shared with Immersive)

IMMERSIVE.md §4 defines a lane-aware runner (`SLOW_KINDS`, a `_lane(...)` helper, a fast lane and a slow lane).

- **If it's already merged:** add the storytime kinds to `SLOW_KINDS`.
- **If not:** implement it exactly as IMMERSIVE.md §4 describes, with `SLOW_KINDS = ("storytime_script", "storytime_render")`.
  Add the worker isolation test from that section, using a slow fake storytime job. The Immersive work
  then only appends its kind.

`MAX_ATTEMPTS` stays 3. Rename `immersive_concurrency` to `slow_lane_concurrency` (default 2) only if
the Immersive lane isn't merged yet. Otherwise reuse whatever name exists.

### 5.2 Data model: `supabase/migrations/20261026000000_storytime.sql`

Use a new timestamp. Don't edit earlier migrations, and don't reuse a prefix that already exists.

```sql
alter table media drop constraint media_kind_check;
alter table media add constraint media_kind_check
  check (kind in ('photo','video','audio','scan','generated_image','generated_video','generated_audio'));

alter table notification drop constraint notification_type_check;
alter table notification add constraint notification_type_check check (type in
  ('request_received','request_declined','story_ready','memory_added','storytime_ready'));

create table storytime (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references family(id) on delete cascade,
  heirloom_id uuid not null references heirloom(id) on delete cascade,
  story_id uuid not null references story(id) on delete cascade,   -- the version it was made from
  requested_by uuid not null,                                      -- auth user id
  status text not null default 'queued' check (status in
    ('queued','scripting','gathering','narrating','rendering','ready','failed')),
  storyboard jsonb,                 -- Storyboard (§5.3); the source of truth for rendering
  assets jsonb,                     -- per-scene storage paths, written as gathered (resumable)
  video_media_id uuid references media(id) on delete set null,
  poster_media_id uuid references media(id) on delete set null,
  duration_ms int,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (heirloom_id)              -- one video per object; regenerate resets the row
);
create index on storytime (family_id, created_at);
alter table storytime enable row level security;
create policy "members read" on storytime for select to authenticated
  using (private.is_member(family_id));
grant select on storytime to authenticated;
alter publication supabase_realtime add table storytime;
```

- **Verify the real constraint names** (`\d media`, `\d notification`) before dropping them.
- "Stale" is derived, not stored: `storytime.story_id` ≠ the latest `story.id` for the heirloom.
- Storage goes in the private `generated` bucket. Paths **must start with the family id** so storage
  RLS keeps working: `{family_id}/{heirloom_id}/storytime/{storytime_id}/{name}.{ext}`. Add a
  `storage.storytime_path(...)` helper and leave `object_path` alone.
- Update DESIGN.md §4.2 and run `make types`.

### 5.3 Stage A: `storytime_script` (`jobs/stages/storytime_script.py`, `prompts/storytime_script.md`)

Load the same materials as `compose_story.run` (segments with narrator ids, facts, context cards,
photos, memory notes, people) plus the latest story's title, dek and blocks, in one connection. Then
release it and call `providers.llm.json(schema=Storyboard)` at the default effort. This lane isn't
latency-critical.

```python
# app/models.py
class SceneVisual(BaseModel):
    source: Literal["family_photo", "generated", "stock"]
    media_id: UUID | None = None          # family_photo: must be one of the given photo ids
    prompt: str | None = None             # generated: Muse Image prompt
    stock_query: str | None = None        # stock: 2–5 words, era + place ("1960s Kathmandu street")
    motion: Literal["zoom_in", "zoom_out", "pan_left", "pan_right"] = "zoom_in"

class NarrationScene(BaseModel):
    type: Literal["narration"]
    narration: str = Field(max_length=320)        # 1–3 spoken sentences, third person
    cites: list[SegmentCite | FactCite] = Field(min_length=1)
    visual: SceneVisual
    caption: str | None = Field(None, max_length=40)   # optional on-screen year / place

class VoiceScene(BaseModel):
    """The storyteller's own words, from the original recording. Narration pauses."""
    type: Literal["voice"]
    segment_ids: list[UUID] = Field(min_length=1, max_length=3)   # consecutive, same turn
    visual: SceneVisual

Scene = Annotated[NarrationScene | VoiceScene, Field(discriminator="type")]

class Storyboard(BaseModel):
    title: str
    mood: Literal["tender", "nostalgic", "joyful", "bittersweet"]
    scenes: list[Scene] = Field(min_length=4, max_length=14)
```

Prompt rules (match the tone of the existing prompts):

- Write all narration and captions in English. Use only original English recordings for voice scenes.
- A warm, unhurried bedtime-story voice in the third person. It never says "I" for the storyteller.
- Include 1–3 `voice` scenes at the emotional peaks, each under about 20 s of audio in total.
- Open and close on the object itself, using a **family photo** when one exists.
- At least half the visuals are family photos or generated images. Stock is for era and place only.
- Generated prompts follow `cover_art.cover_prompt`: painterly, soft light, muted earthy palette.
  **No faces of real family members, no text or letters.** Hands and silhouettes are fine.

Validation, mirroring `compose_story` and reusing `app.citations` where it fits:

- Drop cites that aren't in this heirloom's segments or facts, along with unknown `media_id`s and
  segments that aren't in this heirloom.
- Turn a `family_photo` with a bad id into a `generated` visual.
- Retry once with the problem list, then drop scenes that still fail.
- Fewer than 3 valid scenes means `failed`, with error "not enough story yet".

Save `storyboard`, set `status = 'gathering'`, and enqueue `storytime_render` in the same transaction.

### 5.4 Stage B: `storytime_render` (`jobs/stages/storytime_render.py`)

**Resumable:** read the row first and skip work already recorded in `assets`. Update `status` and
`updated_at` at each step so Realtime drives the UI.

1. **gathering.** Fetch visuals concurrently (`asyncio.gather` with a semaphore of 3; Muse Image takes 9–42 s):
   - `family_photo`: `storage.download("photos", path)`.
   - `generated`: `providers.image.generate(prompt)`.
   - `stock`: `providers.stock.search(query)`, taking the first landscape result. If there's no result
     or an error, **fall back to `generated`** with the query as the prompt.
   - Upload each one to `storytime_path` and record it in `assets` right away (that's what makes it resumable).
2. **narrating.**
   - Narration scenes: `providers.tts.speak(text, language="en")`, then upload.
   - Voice scenes: cut the storyteller's clip from the original answer WAV (`audio` bucket,
     `segment.start_ms` to `end_ms`, padded by 150 ms) with ffmpeg.
   - Measure every clip with `ffprobe`. Scene duration = audio + 0.8 s of rest (voice scenes get
     1.2 s, with the caption "{name}, in their own words").
3. **rendering.** Work in a temp dir with ffmpeg, run in `asyncio.create_subprocess_exec`, never blocking the loop:
   - 1280×720, 30 fps, H.264 + AAC, `-movflags +faststart`.
   - Per scene: scale and crop to fill, then `zoompan` for the chosen motion. Use `xfade` (about 0.7 s) between scenes.
   - A 4 s title card (story title over the cover photo, plus the provenance line from §2.2). A 4 s end card
     ("Told by {storyteller}", then stock credits).
   - Audio: narration and voice clips laid out on the timeline, with the mood music track at about −22 dB,
     ducked under speech (`sidechaincompress`) and **muted under voice scenes**.
   - Captions: generate `.ass` from the scene texts and timings (segment text for voice scenes), and burn
     them in: large, soft white, lower third.
   - Put **all argument construction in one pure function** `build_ffmpeg_args(plan) -> list[str]`, so it
     can be tested without running ffmpeg.
4. Upload the MP4 (`generated_video`) and a poster frame (`generated_image`). Write the media rows, set
   `video_media_id`, `poster_media_id`, `duration_ms` and `status = 'ready'`. Insert `storytime_ready`
   notifications for the storyteller, the request's listener (if `story.request_id`), and the requester's
   person, deduplicated. `notification.recipient_id` is a **person** id.

Errors: any exception sets `status = 'failed'` and `error`, then re-raises so the runner records it. Back off
on provider 429s (honor `Retry-After`) without spending runner attempts.

### 5.5 Providers

`app/providers/base.py`:

```python
class TTS(Protocol):
    async def speak(self, text: str, *, language: str = "en") -> Blob: ...

class StockPhoto(BaseModel):
    url: str
    width: int
    height: int
    photographer: str
    page_url: str

class StockImages(Protocol):
    async def search(self, query: str, *, orientation: str = "landscape") -> list[StockPhoto]: ...
```

- `TTS`:
  - `providers/gemini_tts.py` uses a fixed prebuilt narrator, English only, and returns WAV audio.
  - `settings.tts_provider = "gemini"`; `settings.tts_model` and `settings.tts_voice` select the
    model and one application-wide narrator. No reference audio or voice cloning.
- `StockImages`: `providers/pixabay.py` (`GET https://pixabay.com/api/`). Cache responses in
  `serp_cache` for 24 hours, keyed by a hash of the query/options, without storing the API key.
- Add `tts` and `stock` to the `Providers` dataclass in `providers/__init__.py`. Constructing either with an empty key must
  not raise; they fail only when called.
- **`tests/conftest.py`:** add `FakeTTS` (returns a short silent WAV) and `FakeStock` to `Fakes`, and to the
  `Providers(...)` built in the `fakes` fixture. Otherwise every existing test breaks.

Config (`app/config.py`, `.env.example`), all defaulting to off or empty:

```python
storytime_enabled: bool = False
storytime_daily_limit_per_family: int = 5
tts_provider: Literal["gemini"] = "gemini"
tts_model: str = "gemini-3.8-flash-tts"
tts_voice: str = "Sulafat"
pixabay_api_key: str = ""
```

### 5.6 API: `app/routers/storytime.py` (prefix `/api`, registered in `main.py`)

When `storytime_enabled` is false, every route returns 404 except `available`.

| Method | Path | Who | Behavior |
|---|---|---|---|
| `GET` | `/api/storytime/available` | signed in | `{available}`: the flag is on, the Gemini key exists, and `ffmpeg` / `ffprobe` are on PATH. Stock is optional. |
| `POST` | `/api/stories/{heirloom_id}/storytime` | storyteller or owner | Requires a published story. Over the daily cap → 429. A row that's in progress → return it (200). Otherwise upsert the row (reset status, storyboard, assets and error, set `story_id` to the latest) and `enqueue("storytime_script", ...)` in one transaction → 202 |
| `GET` | `/api/stories/{heirloom_id}/storytime` | member | `{status, stale, video_url, poster_url, duration_ms, credits}`. Signed URLs come from `signed_download_url`; video URLs get `expires_in` of about 6 h |
| `DELETE` | `/api/stories/{heirloom_id}/storytime` | storyteller or owner | Delete the row and its storage objects |
| `GET` | `/api/public/stories/{heirloom_id}/storytime?k=` | public | Same as GET, only when `ready`. Check `k` against `family.invite_code`, like `get_public_story` |

Use `require_member` and `family_of_heirloom` the same way `stories.py` does. Run `make types` afterwards.

## 6. Frontend

- `lib/realtime.ts`: add `'storytime'` to the `Table` union.
- `components/storytime/StorytimePlayer.tsx`:
  - a poster image with a large play button, then native `<video controls playsInline preload="metadata">`
  - a "Made from an earlier version" badge when `stale`
  - a credits disclosure
  - Match the existing UI kit (`components/ui/*`, Tailwind, framer-motion, lucide).
- `components/storytime/StorytimeCard.tsx`: the opt-in card and progress chip. Subscribe with
  `useLiveQuery('storytime', \`heirloom_id=eq.${id}\`, key)`. Show **Retry** on `failed`. Fire a
  `lib/haptics.ts` tap on Create and on ready.
- `StoryView.tsx`: render the player above the story when the video is `ready`. Render the card for the
  storyteller or owner when there's no video or it's in progress. The viewer's identity comes from
  `lib/me.ts` and the family membership endpoint.
- `PublicStory.tsx`: the player only, through the public endpoint. Never show the card.
- `Notifications.tsx`: handle `storytime_ready` by linking to `/h/:heirloomId`.
- **Bundle:** keep it under about 5 KB gzip on the entry chunk. Use the native `<video>` and no player library.

## 7. Tests (`make test`, with no live keys in CI)

- **Worker:** lane isolation. A slow fake `storytime_render` must not delay `next_question`, and the slow-lane cap holds.
- `test_storytime.py`:
  - **POST rules:** 404 when the flag is off, 403 for a non-member or a non-storyteller member, 409 with no
    published story, 429 over the cap, an idempotent re-POST while running, and a failed or ready row reset on regenerate.
  - **Script validation:** an uncited narration line, a foreign segment id and a bad `media_id` are each
    repaired or dropped. Fewer than 3 valid scenes means `failed`.
  - **Render happy path with fakes:** the row reaches `ready`, every storage path starts with `{family_id}/`,
    and notifications go to the right deduplicated person ids.
  - **Resume:** existing `assets` entries are not regenerated (assert the fake image and TTS call counts).
  - **Stock fallback:** an empty Pexels result means `image.generate` is called.
  - **`build_ffmpeg_args`:** the scene count, xfade offsets that sum to `duration_ms`, captions referenced, and
    music muted during voice scenes.
  - **A real ffmpeg smoke test** on 3 tiny scenes, skipped if ffmpeg is missing.
  - **Public GET:** a wrong `k` or a non-ready video returns 404. **Stale:** a new story version gives `stale: true`.
- Every existing test passes unchanged, apart from the `conftest.py` fakes.
- `scripts/e2e_pipeline.py`: an opt-in `--storytime` flag that runs it live and prints per-stage timings.

## 8. Done means

- [ ] Migration applied. DESIGN.md updated: §3.4 (TTS and Pexels verification), §4.2 (table), §5.1 (two
      slow-lane stages), §5.6 (routes), and a short §5.11 "Storytime video".
- [ ] A real interview → Create on the story page → a playable 60–150 s MP4 with narration, at least
      one clip of the storyteller's own voice, captions, music, a family photo, generated art and stock era images,
      in under about 5 min.
- [ ] Every narrated line traces to a segment or fact id (inspect `storyboard`).
- [ ] Members and public-link viewers can play it. Non-members can't. Only the storyteller or owner can create it.
- [ ] The interview latency in DESIGN §3.4 still holds (±10%) **while a storytime render runs**
      (`uv run python -m scripts.e2e_pipeline`).
- [ ] `git diff --stat` shows no changes to the frozen files in §2.3.
- [ ] `make lint`, `make test` and `pnpm build` are clean. Add a dated entry to `goals/PROGRESS.md` with the measured timings.

## 9. Order of work (commit per step)

1. **Foundation:** migration, models, config, protocols with fakes in `conftest.py`, `JobKind` and the slow
   lane (or `SLOW_KINDS`), and the worker isolation test.
2. **Script stage:** the stage, its prompt and validation, and its tests.
3. **Render stage:** the pure ffmpeg builder and its tests first, then the stage against fakes, then the real
   Pexels and TTS adapters.
4. **API:** the router, `make types`, and the API tests.
5. **Frontend:** the card, player, Realtime, public view and notification.
6. **Live check:** the `check_services.py` probes, the e2e run, and timings in DESIGN.md and PROGRESS.md.

## 10. Out of scope

- Editing scenes by hand, custom music uploads, choosing a voice per family.
- Voice cloning or any narration that imitates the storyteller (forbidden by §2.1).
- Generative video models. Translation, non-English interviews, and non-English narration or captions.
- Creating videos automatically after interviews.

## 11. Implemented refinements

The checked implementation and remaining verification are tracked in `docs/STORYTIME_TODO.md`.
The migration file is the authoritative schema; the initial schema sketch above is expanded with
`generation_id`, `video_story_id`, and an internal `storytime_attempt` ledger. Each job uses an
immutable attempt ID, and stale/removed jobs cannot publish over a newer request. Explicit requests,
including regenerate and requests later removed, count toward the rolling 24-hour family cap.

Regeneration resets the working storyboard/assets but retains successful media until its replacement
is ready. Member and public viewers can keep playing that completed video during regeneration;
staleness compares its `video_story_id` with the latest published story. Permissions come from the
backend's `can_manage` response. The UI mounts a native player and controls above `StoryView` in the
member/public routes, with Realtime and polling for member progress.

Original audio is selected only from English interviews by the storyteller, in consecutive segments
of one answer. Narration is third person, citations are checked, unsupported years are rejected,
and invalid scripts are retried once. The source title is preserved. Measured audio determines the
timeline; very short stories fail with a request for another memory instead of adding long silence.
One FFmpeg encode runs at a time with two encoder threads. All provider/storage calls run outside
database connections. Generated Storytime assets are excluded from cover selection.

Use `uv run python -m scripts.check_services --storytime-only` for English TTS, Pixabay, and codec
checks, and `uv run python -m scripts.e2e_pipeline --storytime` for an explicitly opted-in synthetic
family pipeline run. No real family video is created automatically.
