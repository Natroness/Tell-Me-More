# Storytime implementation research

Researched 2026-10-25 against `STORYTIME.md` and the current working tree. This is a recommendation, not an implementation or a revision of the approved spec. External service availability and prices can change. The initial research used documentation only; authenticated follow-up checks are recorded below. No production database changes were made.

**Language scope: English only.** Interviews, transcripts, stories, generated narration, captions, and validation samples must all be in English. Translation and support for other languages are out of scope.

## Live credential check — 2026-10-25 follow-up

After the initial research, the user reported upgrading Gemini to Tier 1 and adding a Pixabay key. Both keys were found in `backend/.env`; their values were not logged.

- **Pixabay passed:** image search returned HTTP 200, three results, and `totalHits=500` for “old pocket watch”. A selected image downloaded successfully as a 398,313-byte JPEG. The response reported a limit of 100 requests and 99 remaining in the current window.
- **Gemini authentication/model discovery passed:** listing models returned HTTP 200 and included `gemini-3.8-flash-tts` and `gemini-3.8-flash-lite-tts`.
- **Gemini generation is blocked by billing:** a structured-output call to the configured `gemini-3.8-flash` model and a short English speech request to `gemini-3.8-flash-tts` all returned HTTP 402, `RESOURCE_EXHAUSTED`, with “Your prepayment credits are depleted.” No narration was generated, so voice quality and successful TTS latency remain unverified.
- **Next action:** in [AI Studio Projects](https://ai.studio/projects), select the project associated with the configured key and manage billing / buy prepaid credits. Google's [billing documentation](https://ai.google.dev/gemini-api/docs/billing#prepay) distinguishes the usage tier from a positive prepaid balance and currently lists a $5 minimum credit purchase. Model discovery does not establish the project's tier or generation quota.

The credential probes did not change billing, database state, or application code. Pixabay credentials are ready, but the application still needs a Pixabay setting and provider adapter. Retry Gemini generation after the balance is funded.

### Recheck after billing update — passed

The subsequent user-requested live recheck succeeded with the same configured credentials:

| Check | Result | Request time |
| --- | --- | --- |
| `gemini-3.8-flash` structured JSON | HTTP 200, `{"ok": true}` | 3.15 s |
| `gemini-3.8-flash-tts`, Sulafat, English | HTTP 200, 6.20 s of mono 24 kHz WAV audio | 3.07 s |

The earlier billing blocker is resolved. WAV headers and durations were checked; pronunciation and subjective voice quality still need listening review. Gemini narration and Pixabay stock retrieval now both have successful live probes. This does not verify the project's exact tier, sustained quotas, or the complete Storytime pipeline.

## Recommendation

Build a small, deterministic slideshow renderer in the existing Python backend. Reuse Muse for the cited storyboard and illustrations, use a fixed English Gemini narrator voice, and render with FFmpeg. Put stock search behind the existing proposed `StockImages` protocol, with Pixabay as an alternative to Pexels. Keep family photos and generated illustrations as fallbacks when stock is unavailable.

The distinctive work is preserving source citations, original family audio, permissions, and resumable jobs. An end-to-end video generator does not supply those application rules. Its stock-search and rendering patterns are useful references, but adopting its entire application would add another configuration, persistence, and execution system.

## Open-source projects worth examining

| Project | Verified capabilities | Fit for this repo |
| --- | --- | --- |
| [MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo/blob/main/README-en.md), [MIT](https://github.com/harry0703/MoneyPrinterTurbo/blob/main/LICENSE) | Custom scripts, uploaded audio, local images/videos, stock sourcing through Pexels/Pixabay, subtitles, music, horizontal output. | Closest end-to-end reference. Good for an isolated experiment using a prepared script and mixed audio track. Our citation and per-scene voice rules still need custom integration. |
| [ShortGPT](https://github.com/RayVentura/ShortGPT), MIT | Automated footage search, captions, voice synthesis, a JSON editing system, MoviePy rendering. | Useful design reference. Its [video engine](https://github.com/RayVentura/ShortGPT/blob/stable/shortGPT/engine/content_video_engine.py) turns timed captions into timed stock queries. Its TinyDB persistence and generic internet-image sourcing do not match our backend and media rules. |
| [MoviePy](https://github.com/Zulko/moviepy/blob/master/README.md), MIT | Python image/audio/video composition, cuts, text, transitions and export. | Reasonable prototype option. Its maintainers explicitly describe the Python frame-processing overhead versus direct FFmpeg. Use v2 APIs if adopted; many older tutorials use incompatible v1 syntax. |
| [Auto-Editor](https://github.com/WyattBlue/auto-editor), Unlicense for repository code | Automatically cuts audio/video based on loudness and other signals. | Useful for silence cleanup, not semantic illustration or stock selection. Avoid removing the reflective pauses that give these stories their character. |
| [WhisperX](https://github.com/m-bain/whisperX), [BSD-2-Clause](https://github.com/m-bain/whisperX/blob/main/LICENSE) | Transcription, forced alignment and word-level timing; optional speaker diarization. | Add only if the existing audio timings prove insufficient. Use English alignment; diarization introduces extra models and a Hugging Face token. We already know the interview speaker, so diarization is unnecessary. |
| [Kokoro](https://github.com/hexgrad/kokoro), [Apache-2.0](https://github.com/hexgrad/kokoro/blob/main/LICENSE) | Local TTS with open weights and predefined voices. | A path to narration without a cloud API key. Adds local model/runtime dependencies. Use a fixed English voice and verify its quality before adopting it. |

These were inspected through their primary repositories. They have not been installed or benchmarked here. Code licenses do not establish the licenses of bundled stock, fonts, music, or downstream models. In particular, MoneyPrinterTurbo's README flags uncertainty around some bundled music; bring our own verified tracks.

## Two assumptions in STORYTIME.md need updating

**Pexels credentials may be unavailable to a new account.** Its [API landing page](https://www.pexels.com/api/) and [key help page](https://help.pexels.com/hc/en-us/articles/900004904026-How-do-I-get-an-API-key) currently say that new key issuance is paused. If the team already has a key, test it; otherwise avoid making it a launch dependency.

[Pexels API documentation](https://www.pexels.com/api/documentation/) specifies an Authorization header and default limits of 200 requests/hour and 20,000/month. It also asks for a prominent Pexels link and photographer credit where possible. Its [general media license](https://www.pexels.com/license/) and API integration guidelines are separate considerations.

**OpenAI's older Speech API models are deprecated.** Official [OpenAI documentation](https://developers.openai.com/api/docs/guides/text-to-speech) says `tts-1`, `tts-1-hd`, and `gpt-4o-mini-tts` shut down January 6, 2027. The replacement uses the Realtime API; it is not a model-name substitution on `/v1/audio/speech`. The spec's adapter boundary is still useful, but I would choose another narration adapter for this build.

## Narration and stock choices

**First choice for narration: Gemini**, with English generation verified by the live probe above. The repo already depends on `google-genai` and has `GEMINI_API_KEY` configuration. Google's [speech guide](https://ai.google.dev/gemini-api/docs/speech-generation) documents `gemini-3.8-flash-tts`, fixed prebuilt voices and WAV output. Choose one fixed narrator voice after reviewing the English sample. Never send reference family audio for cloning. Add `gemini` to the proposed TTS provider choices; the existing Gemini chat adapter does not implement speech.

If Gemini fails the listening or availability check, [ElevenLabs speech with timestamps](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps) is a separate-key alternative that returns audio and character alignment. Validate English voice quality and plan access before choosing it.

**Stock alternative: Pixabay.** Its [API docs](https://pixabay.com/api/docs/) expose an API key to logged-in users, support image/video search, and specify 100 requests per 60 seconds, 24-hour response caching, and downloading selected images rather than permanent hotlinking. Treat this as a bounded search triggered by Create, not a bulk harvesting system. Verify account access before depending on it.

Search for visual concepts, not personal claims. For example, “train platform” can illustrate travel, but a modern platform must not be presented as the actual station from a 1960s memory. Search several candidates, filter for relevance and adequate resolution, and fall back to an explicitly imagined illustration when era/place authenticity matters. Do not take the first landscape image blindly. Keep provider, asset ID, photographer, source page, and license reference with each chosen asset. Exact historical imagery is a separate archival-research feature.

## What the current code already supplies

- `jobs/runner.py` already has separate fast and slow lanes in the current working tree; `SLOW_KINDS` currently contains `immersive_world`. Extend this work rather than reimplementing the runner. It is currently part of uncommitted Immersive changes.
- `compose_story.py` already loads the story materials and validates citations. Reuse the approach, with Storytime-specific models and validation.
- Original audio is available through segment → turn → media. `routers/stories.py` already resolves this relationship.
- `cover_art.py` already uses Muse Image. `DESIGN.md` reports previously observed image-generation latency of 9–42 seconds; those are existing project measurements, not fresh measurements from this research.
- This laptop has `ffmpeg` and `ffprobe`; the installed FFmpeg includes `zoompan`, `xfade`, ASS/subtitles and sidechain compression. The Vultr worker still needs its own check.

## A realistic first release

1. **Prove the media path first.** From a saved English story, create a local 60–90 second sample with 6–8 scenes, a fixed English narrator, one original English voice excerpt, family pictures, one or two illustrations, readable English sentence captions, and a single verified CC0 music track. Check English pronunciation. This can start as a script without changing interview code.
2. **Integrate the proven renderer.** Add the opt-in create/status/remove routes, a new migration, resumable script/render jobs in the slow lane, private generated assets, and the native video player. Preserve membership checks and public-link access rules from the spec. Track the source story version.
3. **Finish resilience and polish.** Add bounded stock search, credits, retries, cancellation protection, regeneration, notifications, and production timing checks. Keep an existing ready video playable until its replacement succeeds. Stock absence should fall back gracefully.

Use one measured timeline for audio, pictures, captions and transitions. Generate narration in short sentence/scene chunks, measure the resulting files with ffprobe, and use those real durations. FFmpeg supports the needed effects; its [filter documentation](https://ffmpeg.org/ffmpeg-filters.html#xfade) requires matching resolution, frame rate, pixel format and timebase for crossfades. Account for transition overlaps when scheduling audio and computing final duration, so a fade cannot truncate speech.

My engineering estimate, assuming working credentials and a usable saved story: about one focused day for an integrated MVP and several days for the full spec plus failure handling and tests. These are estimates. The 2–5 minute generation target is plausible for a small storyboard, but needs measurement on Vultr with real image calls and encoding.

## Implementation details to resolve before building

- **Original voice timing:** `app/segments.py` sometimes divides a speech turn into sentences proportionally by text length. A 150 ms pad cannot guarantee clean boundaries. Initially prefer complete short answer turns or validate/refine cuts in the slow lane. Add English forced alignment later if needed.
- **Duration:** Target 30–75 seconds (halved from the original brief). Budget narration length and original clips, then validate measured duration. Shorten the script or remove optional scenes rather than speeding up family speech. Short memories stay short without silent padding.
- **Provenance:** Checking that citation IDs exist is necessary but does not prove every claim is supported. Validate narration sentence by sentence and keep a source map; label generated/historical-context visuals appropriately.
- **Regeneration and caps:** A single upserted row per heirloom cannot reliably count daily render requests. Use durable attempt accounting and transactional enforcement. Give attempts an identity so old jobs cannot overwrite a regeneration or restore a removed video.
- **CPU isolation:** A separate asyncio lane protects queue slots, not CPU. Start with one FFmpeg render at a time and bounded encoder threads. Measure interview latency under rendering load; move rendering to a separate worker/process allocation if needed.
- **Image identity:** `cover_art.py` currently treats any `generated_image` for an heirloom as the existing cover; `Story.photos` also includes generated images. Storytime posters and scene assets need an explicit role/path filter so they are not mistaken for the cover or family originals.
- **Availability:** Change the proposed availability rule to reflect the selected TTS adapter and renderer. A missing stock key should not hide the feature when family/generated visuals are available. This is a proposed spec adjustment, not an implemented change.

## Credentials and setup

| Item | Where to retrieve it | Needed for recommended path? |
| --- | --- | --- |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/api-keys); [key documentation](https://ai.google.dev/gemini-api/docs/api-key) | Yes for cloud narration; reuse the configured key if its project has access/quota. |
| `PIXABAY_API_KEY` | Sign in at [Pixabay API docs](https://pixabay.com/api/docs/) | For automatic stock search if Pexels is unavailable. This setting/adapter still needs adding. |
| `PEXELS_API_KEY` | [Pexels API](https://www.pexels.com/api/) | Alternative stock provider if an existing key works. New issuance is currently paused. |
| `META_API_KEY` and Meta base URL | Existing project/hackathon Meta credentials | Reuse for storyboard writing and illustration generation. A Muse speech-output endpoint has not been verified. |
| Existing Supabase URL, backend secret, DB URL | Existing Supabase project configuration | Reuse; no new Supabase project or credential is needed specifically for Storytime. |
| `ELEVENLABS_API_KEY` or `OPENAI_API_KEY` | Chosen alternative provider's developer account | Only if we select that alternative TTS provider. Not required for the recommended Gemini path. |
| FFmpeg, ffprobe, libass and fonts | Worker operating-system packages | Required software, no API key. Install fonts suitable for readable English captions. |

These are backend secrets; keep provider keys in `backend/.env` and deployment secrets. Suggested future settings are `STORYTIME_ENABLED`, `TTS_PROVIDER=gemini`, a separately configurable TTS model/voice, and `STOCK_PROVIDER=pixabay` or `pexels`. They are not implemented by this research note.

At the published October 25 rates, [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) implies about $0.027 of audio output for two minutes of Flash TTS, plus text input, before any applicable free tier. This excludes Muse images, script generation, storage, bandwidth, retries and VM cost. Project quota and billing access still need a live probe. Google's pricing page distinguishes free-tier and paid-tier data use; choose the appropriate account configuration for family material.

For a demo without new keys, use an already working Gemini key, existing Muse access, family photos and a small manually curated licensed image collection. Automatic stock retrieval can be added once a stock key works. A local English Kokoro narrator is another option. Firecrawl is not required for video creation or licensed stock retrieval, and no Firecrawl tool was connected for this research.
