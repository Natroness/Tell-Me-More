# Immersive Memories: implementation spec for agents

> Feature: any family member opens a story, taps a photo, taps **"Create immersive experience"**, and comes back later to walk through a 3D world of that memory, with tappable spots that play the narrator's own voice.
>
> Status: approved for build. Opt-in and per photo. **It must not change the latency or behavior of capture, image analysis, the live interview (STT), or question generation.**

Read these first: `docs/DESIGN.md` (§2 rules, §4 data model, §5.1 pipeline, §5.3 audio path), `backend/app/jobs/runner.py`, `backend/app/jobs/queue.py`, `backend/app/providers/base.py`, `backend/app/routers/stories.py`, `frontend/src/components/story/StoryView.tsx`.

---

## 0. Non-negotiable rules

1. **Hot path is frozen.** Do not change the behavior of `routers/answer_stream.py`, `routers/interviews.py`, `jobs/stages/{analyze_object,lens_lookup,transcribe_turn,next_question}.py`, `frontend/src/lib/recorder.ts`, `frontend/public/worklets/pcm-capture.js`, `routes/Capture.tsx`, or `routes/Interview.tsx`. If you think one of them must change, stop and ask.
2. **Separate worker lane.** Immersive jobs never run in the main job loop and never use its concurrency slots (§4).
3. **No database connection is held while waiting on World Labs.** The pool is small (`DB_POOL_SIZE=5`, and the Supabase pooler caps at 15). Acquire, write, release, then call the external API.
4. **The 3D viewer is lazy-loaded.** `three` and the splat renderer must not enter the main JS bundle. Capture and Interview load times stay the same (§8.4).
5. **Opt-in only.** Nothing creates a world automatically. No stage enqueues `immersive_world`. Only the explicit API call does.
6. **The AI never speaks as the relative** (DESIGN.md §2). Spots in the world play the narrator's **original audio**. No TTS of her words, no voice cloning.
7. **Provenance.** Every world is labeled "Imagined from {narrator}'s words, not a photograph". A world built on a photo found on the web (§5.6) also credits that photo's page. Each spot links to the `fact` ids and `segment` ids it came from. The scene prompt may only use details from `fact` rows of kind `memory` or `observation` for this heirloom.
8. **Cost and rate safety.** Generate at most one world per source photo (unique constraint), cap worlds per family per day, enforce a feature flag, and back off on HTTP 429.

---

## 1. Which World Labs API to use

| Option | Gives a walkable world? | Use |
|---|---|---|
| **World API v1**, `POST https://api.worldlabs.ai/marble/v1/worlds:generate`, model `marble-1.1` | **Yes.** Returns Gaussian splat files (SPZ at 100k, 500k and full resolution), a panorama, a collider mesh (GLB), a caption and `semantics_metadata`. About 5 min. | **Build on this.** |
| Marble 2 / Atlas beta, `https://api.atlas-beta.worldlabs.ai/api/v2` (`images2PosedRGBD`, `atlasGenerate`, ...) | **No.** Only posed images and new camera views. | Not now. Hide it behind the same `WorldGen` interface so it can be swapped in later. The schemas are incompatible, so never mix them. |

World API facts (docs.worldlabs.ai, checked 2026-10-25):
- **Auth:** header `WLT-Api-Key: <key>`. Credits are bought at platform.worldlabs.ai, separately from the Marble web app.
- **Inputs:**
  - Text: `world_prompt.type = "text"`.
  - Image: `type = "image"`, with `image_prompt.source = "media_asset"` after uploading through `POST /marble/v1/media-assets:prepare_upload`, then a PUT to the signed URL. Use media assets, not public URLs, because family photos are private.
- **Generation flow:**
  - Generating returns an Operation. Poll `GET /marble/v1/operations/{operation_id}` until `done`. The operation expires after about 1 h.
  - The result is in `response.assets`: `splats.spz_urls.{100k,500k,full_res}`, `splats.semantics_metadata.{metric_scale_factor,ground_plane_offset}`, `mesh.collider_mesh_url`, `imagery.pano_url`, `thumbnail_url`, `caption`.
- **Cost:**
  - `marble-1.1`: 1,580 credits ≈ $1.26 per text or image world.
  - `marble-1.0-draft`: 230 credits ≈ $0.18. **Use the draft model in dev and tests that hit the live API.**
- **Rate limits:** about 3 starts per minute and 60 per hour per account. A 429 means the request was not accepted; honor `Retry-After`.
- **Input quality:** Marble is strong on *spaces* (rooms, courtyards, streets) and weak on close-ups and people. Never send a close-up of the object as the image prompt (§5.2). For a close-up, look for a real photo of the place instead (§5.6). One wide photo of the space beats any text prompt: tested 2026-10-25 on a Walmart earbuds story, where text alone gave a grey warehouse with a giant melted case and one aisle photo gave a recognizable store, even on the draft model.

---

## 2. User flow

1. A family member opens a story (`/h/:heirloomId` or the shared `/s/:heirloomId`) and sees its photos: the cover and photo blocks.
2. On a photo they tap **"Create immersive experience"**. Only signed-in family members see this button; the public link never does.
3. A confirm sheet explains:
   - It takes about 5 minutes, and they can leave and come back.
   - It's imagined from the story, not a real photo.
   - The photo is sent to World Labs to build the scene.
4. They tap **Create**. The button turns into a live progress chip: "Writing the scene…", "Building the world (~5 min)…", "Almost ready…".
5. Later, from any device, the photo shows **"Walk through"**. That opens `/w/:worldId`, a full-screen 3D world with glowing spots. Tapping a spot opens a sheet with the memory text, who said it, and a play button that plays the original audio clip.
6. When a world is ready, anyone with the family's public story link can also walk through it (read-only).

---

## 3. Data model

New migration: `supabase/migrations/20261025000000_immersive_world.sql`. **Do not edit the init migration.** `backend/tests/run_with_db.sh` applies every file in order, so the new one is picked up automatically.

```sql
create table immersive_world (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references family(id) on delete cascade,
  heirloom_id uuid not null references heirloom(id) on delete cascade,
  source_media_id uuid not null references media(id) on delete cascade,
  story_id uuid references story(id) on delete set null,  -- latest story at request time; reference only
  requested_by uuid not null,                       -- auth user id
  requested_by_person uuid references person(id) on delete set null,
  status text not null default 'queued' check (status in
    ('queued', 'writing_scene', 'finding_reference', 'generating', 'saving', 'placing_spots',
     'ready', 'failed')),
  input_mode text check (input_mode in ('image', 'reference', 'text')),  -- 'reference': §5.6
  reference jsonb,     -- ReferencePhoto (§5.6) when input_mode = 'reference', else null
  scene_prompt text,
  used_fact_ids uuid[] not null default '{}',
  provider text not null default 'worldlabs',
  model text,
  provider_operation_id text,                       -- persisted BEFORE polling, for idempotent resume
  provider_world_id text,
  assets jsonb,        -- storage paths: {"spz_100k","spz_500k","pano","thumbnail","collider"}
  semantics jsonb,     -- {"metric_scale_factor": float, "ground_plane_offset": float}
  hotspots jsonb not null default '[]',             -- see Hotspot schema below
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_media_id)
);
create index on immersive_world (heirloom_id);
create index on immersive_world (family_id, created_at);

alter table immersive_world enable row level security;
create policy "members read" on immersive_world for select to authenticated
  using (private.is_member(family_id));
grant select on immersive_world to authenticated;
alter publication supabase_realtime add table immersive_world;
```

Spot schema, a Pydantic model in `app/models.py` stored as a list in `hotspots`:

```python
class Hotspot(BaseModel):
    id: str                      # short slug, unique within the world
    label: str = Field(max_length=60)   # "The neem tree"
    fact_ids: list[UUID] = Field(min_length=1)
    segment_ids: list[UUID] = []        # clips to play; may be empty for observation-only spots
    u: float | None = None       # 0..1 on the equirectangular pano (yaw), None if not located
    v: float | None = None       # 0..1 on the pano (pitch)
```

Storage: reuse the private `generated` bucket. Paths **must start with the family id**, or the existing storage read policy (`(storage.foldername(name))[1]`) breaks:
`{family_id}/{heirloom_id}/worlds/{world_id}/{name}.{ext}`. Add a helper `storage.world_path(...)`. Keep `object_path` unchanged.

---

## 4. Worker isolation (the key latency change)

**Today:** `runner.run_worker` claims any queued job, oldest first, with one semaphore (`WORKER_CONCURRENCY=8`). A 5–10 minute job in that pool would hold a slot, and enough of them would delay `next_question`.

**Change:** make claiming lane-aware.

1. `jobs/queue.py`: add `"immersive_world"` to `JobKind`, plus:
   ```python
   SLOW_KINDS: tuple[JobKind, ...] = ("immersive_world",)
   ```
2. `jobs/runner.py`:
   - `_claim(conn, include: Sequence[str] | None, exclude: Sequence[str] | None)`. Add `and kind = any($1::text[])` or `and not (kind = any($1::text[]))` to the inner `select`. Keep `order by created_at for update skip locked limit 1`. The existing partial index `job_queued_idx` still applies.
   - Refactor the loop body into `_lane(stop, concurrency, include=None, exclude=None)`.
   - `run_worker(stop, concurrency)` runs two lanes with `asyncio.gather`:
     - fast lane: `exclude=SLOW_KINDS`, `concurrency=concurrency` (unchanged behavior and `POLL_SECONDS`)
     - slow lane: `include=SLOW_KINDS`, `concurrency=settings.immersive_concurrency` (default 2), poll interval 2 s
   - Keep the startup reset of stuck `running` rows to `queued`. The stage must be safe to resume (§5.4).
   - `MAX_ATTEMPTS` stays 3. The stage handles World Labs 429 and transient errors itself with backoff; it doesn't burn attempts.
3. `HANDLERS["immersive_world"] = immersive_world.run`. The subject id is the `immersive_world.id`.

**Acceptance test** (`tests/test_worker.py`): start the worker with a fake world provider that sleeps for 30 s (patched). Enqueue one `immersive_world` and then one `next_question`. Assert that `next_question` reaches `done` within the normal time, well under the fake world's sleep. Also assert that two slow jobs never run beyond `immersive_concurrency`.

---

## 5. Backend

### 5.1 Config (`app/config.py`, `.env.example`)

```python
worldlabs_api_key: str = ""
worldlabs_base_url: str = "https://api.worldlabs.ai"
worldlabs_model: str = "marble-1.1"          # use marble-1.0-draft in dev
immersive_enabled: bool = False              # feature flag; API returns 404 when off
immersive_concurrency: int = 2
immersive_daily_limit_per_family: int = 5
immersive_poll_seconds: float = 10.0
immersive_timeout_seconds: int = 900
```

### 5.2 Provider (`app/providers/base.py`, new `app/providers/worldlabs.py`)

```python
class WorldAssets(BaseModel):
    world_id: str
    spz_urls: dict[str, str]          # keys: "100k", "500k", "full_res"
    pano_url: str | None
    thumbnail_url: str | None
    collider_mesh_url: str | None
    caption: str | None
    metric_scale_factor: float | None
    ground_plane_offset: float | None

class WorldOp(BaseModel):
    operation_id: str
    done: bool
    error: str | None = None
    result: WorldAssets | None = None

class WorldGen(Protocol):
    async def start(self, *, prompt: str, image: Blob | None, display_name: str) -> str: ...  # operation id
    async def poll(self, operation_id: str) -> WorldOp: ...
    async def fetch(self, url: str) -> bytes: ...   # asset download (streamed into memory)
```

- `WorldLabsWorldGen` uses `httpx.AsyncClient`, matching other adapters, and keeps all World Labs request and response shapes inside this file.
- When `image` is set, upload it with `media-assets:prepare_upload` and a PUT, then send `{"type":"image","image_prompt":{"source":"media_asset","media_asset_id":...},"text_prompt": prompt}`. Otherwise send `{"type":"text","text_prompt": prompt}`.
- On 429, raise a typed `RateLimited(retry_after: float)`.
- Add `world: WorldGen` to the `Providers` dataclass. Constructing it with an empty key must not raise; it only fails when called.
- **Update `tests/conftest.py`:** add `FakeWorldGen` to `Fakes` and to the `Providers(...)` built in the `fakes` fixture. Otherwise every existing test breaks.

### 5.3 Prompts (`app/prompts/`)

- `immersive_scene.md`: the input is the source photo plus a numbered list of facts (memory and observation, each tagged with its id) and the narrator's name. It returns:
  ```python
  class SceneSpec(BaseModel):
      input_mode: Literal["image", "text"]  # "image" only if the photo shows a wide or medium view of a PLACE
      scene_prompt: str = Field(max_length=900)   # environment, materials, light, era; no people as main subject
      used_fact_ids: list[UUID] = Field(min_length=1)
      hotspots: list[HotspotPlan] = Field(min_length=1, max_length=6)  # label, fact_ids, segment_ids
      place_query: str | None   # Google Images search for this kind of place (§5.6)
      place_name: str | None    # one specific place Google Maps can find, or null
  ```
  - Use only listed facts and invent nothing about the family.
  - Describe the *place* where the remembered moment happened. The heirloom may appear as one small object named in a few words, never with its wear or marks: detail on the object makes Marble blow it up to fill the scene.
  - No text or signage, and no identifiable faces.
- `immersive_reference.md`: the input is the scene prompt plus numbered thumbnails of web photos. It returns the usable ones, best first (§5.6).
- `immersive_spots.md`: the input is the generated pano, downscaled to about 2048 px wide, plus the spot labels. It returns `u,v` for each label it can see, or null.

### 5.4 Stage (`app/jobs/stages/immersive_world.py`)

`run(world_id)`. **Every step is resumable.** Read the row first and skip steps already done. Update `status` and `updated_at` at each step so Realtime drives the UI.

1. **Load** (one connection, then release): the world row, photo media, heirloom, narrator name, and facts of kind `memory` and `observation`. Load segments the same way `routers/stories.py::_load_story` does. If `status = 'ready'`, return.
2. **writing_scene** (skip if `scene_prompt` is set):
   - Download the photo and call `providers.vision.json(..., schema=SceneSpec, images=[blob])` with the default effort. This lane isn't latency-critical, and the default effort writes better prompts.
   - Validate that every `used_fact_ids` and `hotspots[*].fact_ids` and `segment_ids` belongs to this heirloom, and drop anything that doesn't.
   - If nothing valid remains, set `failed` with error "not enough story details yet".
   - If `input_mode` is "text" and the scene has a `place_query`, set `finding_reference` and look for a real photo of the place (§5.6).
   - Save `scene_prompt`, `input_mode`, `reference`, `used_fact_ids`, and the planned spots (no u,v yet) in one write, so a job that dies mid-search writes the scene again rather than leaving half of it.
3. **generating:**
   - If `provider_operation_id` is null, call `world.start(...)` with the family photo (`image`), our copy of the reference (`reference`), or no image (`text`), and **commit `provider_operation_id` immediately**.
   - Then poll every `immersive_poll_seconds`, without holding a DB connection, until done or `immersive_timeout_seconds`.
   - On `RateLimited`, sleep `retry_after` with jitter and retry. On an expired operation or a provider error, clear `provider_operation_id` and fail with the error, so a user retry starts fresh.
4. **saving:** download `spz_100k`, `spz_500k`, `pano` and `thumbnail` (plus `collider` if present) and upload them to storage at `world_path`. Save `assets` and `semantics`. **Do not store World Labs URLs as the source of truth; they may expire** (see §10).
5. **placing_spots:** call vision on the pano with the spot labels and write `u,v` into `hotspots`. If this step fails, keep the spots without positions; the viewer shows them as a list. Never fail the world because of this step.
6. **ready.**

Error handling: any exception in steps 2–4 sets `status = 'failed'` and `error`, then re-raises so the runner records the job error. Step 5 never raises.

### 5.5 API (new `app/routers/immersive.py`, registered in `main.py`)

All routes return 404 when `immersive_enabled` is false.

| Method | Path | Behavior |
|---|---|---|
| `POST` | `/api/heirlooms/{heirloom_id}/photos/{media_id}/immersive` | Requires membership (`require_member`), a media row that belongs to the heirloom with kind `photo` or `scan`, and at least one `memory` fact (otherwise 409, "Finish the interview first"). Then: if a world already exists for the photo and isn't failed, return it (200). If it failed, reset it to `queued` and re-enqueue. Otherwise check the daily family cap (429 if over), then insert and `enqueue(conn, "immersive_world", world_id, family_id)` in one transaction and return 202. |
| `GET` | `/api/heirlooms/{heirloom_id}/immersive` | Lists `{id, source_media_id, status, thumbnail_url?}` for the heirloom, so the story page can badge photos. |
| `GET` | `/api/immersive/{world_id}` | Requires membership. Returns `ImmersiveWorld`: status, label text, narrator name, signed URLs for each asset (use `signed_download_url("generated", ...)`, about 1 h expiry), `semantics`, and spots resolved to fact text plus `ResolvedSegment` (reuse the model in `stories.py`) with audio URLs. |
| `GET` | `/api/public/immersive/{world_id}?k=` | The same data, read-only, only when `status = 'ready'`. Validate `k` against the family `invite_code`, like `get_public_story`. |

Also add to the `Story` response in `stories.py`: `photos: dict[UUID, str]`, signed URLs for each photo block's `media_id` and the heirloom cover. Add it as a new field and leave the existing fields untouched. Run `make types` afterwards.

### 5.6 Reference photos (`app/world_reference.py`)

A close-up of the object can't show Marble the place, so for a `text` scene we look for a real photo of it.

1. Search `search.images(place_query)` (SerpApi `google_images`). When the scene names a specific place, also search `search.place_photos(place_name)` (SerpApi `google_maps`, then `google_maps_photos` in the "Inside" category).
2. Shortlist up to 8: the named place's own photos first, then image results at least 1024 px wide.
3. Download each full-size file once. Keep those that are a JPEG, PNG, or WebP under 8 MB, up to 16 MB in all.
4. Ask vision (`immersive_reference.md`) which are wide, eye-level views of the space, best first. It sees the same full-size files World Labs would get, since a thumbnail hides watermarks. Upload the best to `world_path(..., "reference", ext)` and save a `ReferencePhoto` (path, mime, source URL, page URL, title, `via`) as `reference`, with `input_mode = 'reference'`.
5. Nothing usable, or any error, leaves the world as `text`. This step never fails a world.

One photo, not `multi-image`: web photos of different places don't stitch into one space. Marble copies big lettering in the photo (floor stickers, banners) as garbled text. Filtering it out doesn't work for stores, where most photos have signs and the ones without are watermarked stock (tested 2026-10-25, 5 of 7 Walmart aisle photos had big lettering). The viewer credits the photo's page under the label. Search results are cached in `serp_cache`.

---

## 6. Frontend

### 6.1 Story page (`components/story/StoryView.tsx`)

- Implement the `'photo'` block, currently a TODO. Show the image from `story.photos[media_id]` with its caption sentence; use the existing `renderSentence`, so captions keep provenance chips. Also render the cover photo at the top.
- Add `components/immersive/ImmersiveButton.tsx`, overlaid on each photo for signed-in members:
  - **no world:** "Create immersive experience", which opens a confirm sheet with the copy from §2.3 and the button **Create**.
  - **queued, writing_scene, finding_reference, generating, saving, placing_spots:** a progress chip with friendly text and an elapsed timer. Subscribe with `useLiveQuery('immersive_world', \`heirloom_id=eq.${id}\`, key)`; add `'immersive_world'` to the `Table` union in `lib/realtime.ts`.
  - **ready:** "Walk through", linking to `/w/:worldId`, or `/s/:heirloomId/w/:worldId` on the public page.
  - **failed:** "Couldn't build this one", with Retry, which POSTs again.
- `PublicStory.tsx` shows **Walk through** only for ready worlds and never shows Create.

### 6.2 Viewer (new lazy route)

- Register the routes with React Router's `lazy` or `React.lazy`, so the `three` and splat-renderer code is its own chunk:
  - `/w/:worldId` inside `AuthGate`
  - `/s/:heirloomId/w/:worldId` public, passing `k`
- Dependencies, only in this chunk: `three` and World Labs' Spark renderer (`@sparkjsdev/spark`, which their docs recommend for Marble SPZ). **Pin exact versions you have verified exist on npm and are at least 2 weeks old.** Follow `docs.worldlabs.ai/api/rendering-spz` for scale: apply `metric_scale_factor` and `ground_plane_offset` from `semantics`.
- Load `spz_100k` on phones (coarse pointer or narrow screen) and `spz_500k` on desktop. Show the thumbnail as a placeholder while loading.
- Controls:
  - **phone:** drag to look, two-finger drag or pinch to move forward and back, plus a "reset view" button
  - **desktop:** drag to look, WASD or arrow keys
  - The camera starts at the world origin, roughly the panorama's center.
- Spots:
  - Convert `u,v` to a direction: yaw = (u − 0.5)·2π, pitch = (0.5 − v)·π. **VERIFY the pano yaw convention against one real world before trusting it** (§10).
  - Place each spot by raycasting that direction against the collider mesh if present, otherwise at 2 m × `metric_scale_factor`.
  - Draw each spot as an HTML element projected each frame, with large touch targets (at least 48 px) and a gentle pulse.
  - Spots with no `u,v` go in a "Memories in this place" list button instead.
- Spot sheet:
  - the label
  - the memory sentences (fact text)
  - "{Narrator} said:" with the segment text and a ▶ button that plays `audio_url` from `start_ms` to `end_ms`, reusing the playback approach in `StoryView.play`
  - the provenance chip
- A permanent top banner: "Imagined from {narrator}'s words · not a photograph". Keep the type large; elders will use this.
- On unmount, dispose the renderer, geometries and textures, and stop audio.

---

## 7. Tests (all run with `make test`; there are no live keys in CI)

- `test_worker.py`: lane isolation (§4) and slow-lane concurrency cap.
- New `test_immersive.py`:
  - **POST rules:** 403 for non-members, 409 with no memory facts, 429 over the daily cap, idempotent re-POST, failed → re-queued, 404 when the flag is off.
  - **Stage happy path:** the fakes return a `SceneSpec`, an operation id and then assets, plus spot positions. The row ends `ready`, with storage paths under `{family_id}/`.
  - **Resume:** the row already has `provider_operation_id`, so `start()` is **not** called again.
  - **Validation:** a `SceneSpec` citing a fact id from another heirloom gets that id dropped. If nothing valid is left, the world fails cleanly.
  - **Reference photo:** a close-up with a `place_query` is built on the picked web photo, the named place's Maps photos come first, a pick that won't download falls to the next, and nothing usable or a failed search still builds from text.
  - **Spot failure:** an exception in placement still ends `ready`, with spots that have no `u,v`.
  - **Rate limit:** `RateLimited` from `start()` makes the stage back off and retry (patch sleep), without failing the job.
  - **Public GET:** a wrong `k` returns 404, and a non-ready world returns 404.
- Every existing test must pass unchanged, apart from `conftest.py` gaining `FakeWorldGen`.

---

## 8. Latency guardrails (must hold before merge)

1. `uv run python -m scripts.e2e_pipeline` (live keys, run locally): "next question ready after Done" stays within ±10% of the DESIGN.md §3.4 figure (3.9–6.3 s) **while 2 immersive jobs are running**.
2. No new code in `answer_stream.py`, `interviews.py`, the four interview and capture stages, `recorder.ts`, or the worklet. Check with `git diff --stat`.
3. The slow lane never holds a pool connection across a World Labs call or an `asyncio.sleep`. Reviewers grep for `pool().acquire()` scopes in `immersive_world.py`.
4. In `pnpm build` output, `three` and Spark appear only in the lazy viewer chunk. The entry chunk grows by under 5 KB gzip, for the button and progress chip only.
5. Muse calls from this feature run only in the slow lane, at most `immersive_concurrency` at a time, so they can't crowd out interview calls.

---

## 9. Work breakdown (parallel after step A)

| Step | Owner | Depends on | Done when |
|---|---|---|---|
| **A. Foundation** | backend | none | migration, `Hotspot` and `SceneSpec` models, config, `JobKind`, lane-aware runner, worker isolation test green |
| **B. Provider and stage** | backend | A | `worldlabs.py`, `FakeWorldGen`, prompts, `immersive_world.py`, stage tests green |
| **C. API** | backend | A | routes, `Story.photos`, `make types`, API tests green |
| **D. Story-page UI** | frontend | C (types) | photo blocks render, button states driven by Realtime, public page shows Walk through only |
| **E. Viewer** | frontend | C (types) | lazy route, splat loads on a phone over the `make tunnel` URL, spots play the right clips, §8.4 holds |
| **F. Live check and docs** | any | B | `scripts/check_services.py` gets an opt-in `--worlds` check (draft model, about 230 credits), DESIGN.md gets a short §5.10 "Immersive memories" plus a row in the build plan |

Commit per step. Run `make lint` and `make test` before every push.

---

## 10. VERIFY before or while building (record results in DESIGN.md §3.4)

1. The World Labs API key works, credits are bought on **platform.worldlabs.ai**, and one `marble-1.0-draft` text world succeeds. Note the real generation time.
2. **Do asset URLs (`spz_urls`, `pano_url`) expire?** If they don't, copying to storage is still kept for privacy and RLS, but can become lazy.
3. SPZ file sizes for 100k and 500k (confirm they fit Supabase's upload limit), and frame rate on a mid-range phone.
4. Pano yaw convention and origin: does u = 0.5 face the initial camera direction? Fix the u,v to direction formula once, in one helper.
5. The current Spark package name and version, and its SPZ loading API.
6. Whether `image` input mode beats `text` for old scanned photos of places. Try one of each.
7. Privacy copy: confirm the family is OK sending the photo to World Labs. The confirm sheet must say so.

---

## 11. Out of scope for this version

- Talking to the AI inside the world (STT/TTS); it may come later through the existing WebSocket design.
- A 3D model of the object (SAM 3D) placed in the world.
- Editing, expanding or regenerating variations of a world.
- Marble 2 / Atlas view generation; keep it behind `WorldGen` for later.
- Creating worlds automatically after interviews.