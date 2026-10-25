# Tell Me More

**Tagline:** Families don't lose heirlooms. They lose what the heirlooms mean.

## Inspiration

Every family has a drawer of things nobody can explain anymore. A watch with an engraving, a ring that was resized twice, a photo of a street that no longer looks like that. The person who knows the story is usually still here. Nobody has asked them yet, and once they're gone, the object goes quiet.

We wanted to make that conversation easy to start and worth keeping. A grandchild points a phone at Nani's ring, and twenty minutes later the whole family has a page where Nani tells them, in her own voice, who "R & S 1961" were.

One rule shaped everything we built: **the AI helps people remember, and it never speaks for the person remembering.** Their original audio is the source of truth. Generated text cites it, and we never clone or imitate their voice.

## What it does

1. **Capture.** Photograph an heirloom. Muse Spark reads what's in the photo (engravings, wear, repairs, materials) and SerpApi's Google Lens finds visual matches to date the style and era.
2. **Read the object.** Each detail becomes a gentle question: "The band looks resized. Do you remember why?"
3. **Interview.** The relative gets one large question at a time on screen, which can also be read aloud. They talk, Muse Voice Transcribe captures the answer with timestamps, and Muse Spark picks the next question based on what they said and what's still unknown. Five to eight questions, about five minutes.
4. **Story page.** The app produces a short documentary-style page: cover art from Muse Image, a polished narrative, pull quotes, a timeline, people and places, and "what was the world like then" cards built from Google Search and News. **Every sentence carries a provenance chip:** *their words*, *what the photo shows*, *verified history*, or *AI bridge text*. Tap one of their sentences and their voice plays from that exact moment.
5. **Family adds on.** Share a link. An uncle records his own 30-second memory of the ring, it appears attributed to him, and the story regenerates with his part woven in.

Beyond the core loop:

- **Immersive Memories.** Tap a photo and World Labs builds a walkable 3D world of the place in the story, such as the kitchen, the shop, or the train platform. Glowing spots in the world play the narrator's original audio clips. Every world is labeled "Imagined from {narrator}'s words, not a photograph."
- **Storytime videos.** A 30 to 75 second slideshow that retells the story for relatives who won't read a page. It mixes the family's photos, Muse illustrations and period stock photos. A clearly AI, third-person narrator guides it, and it pauses for real clips of the storyteller. Captions are sized for older eyes.
- **Family tree, requests and scheduling.** Invite relatives, place them in a family tree, ask a specific person to tell the story of a specific object, and find a time when you're both free to call.

## How we built it

- **Frontend:** Vite, React, TypeScript and Tailwind as a mobile-first web app, since the people we're building for already have a phone browser and don't want to install anything. Audio is captured as 16 kHz mono PCM through an AudioWorklet. The 3D viewer (three.js with a Gaussian splat renderer) is lazy-loaded so it never slows down capture or the interview.
- **Backend:** FastAPI on Python 3.12 with uv. A single process serves the API and runs a Postgres-backed job worker (`select … for update skip locked`, with retries). The pipeline runs in stages: analyze object, Lens lookup, transcribe turn, next question, extract facts, update coverage, compose story, era context, cover art, then the opt-in immersive and Storytime stages.
- **Data:** Supabase Postgres, Auth, Storage and Realtime, with row-level security on everything. The backend never pushes to the browser. It writes rows, and the browser subscribes to them. That let us drop all streaming code from the server while the interview screen still updates live.
- **Provenance model:** Every claim in a story is a `fact` that points to the transcript `segment` (with millisecond timestamps), photo observation or search result it came from. The story composer has to cite those ids, and a validator rejects any sentence that cites something that doesn't exist. That's how tap-to-hear works and how we keep the model from inventing names and dates.
- **Models:** Meta's Muse Spark for vision, interview questions, fact extraction and story writing. Muse Voice Transcribe for speech. Muse Image for covers and illustrations. Gemini TTS provides one fixed narrator voice for Storytime, and FFmpeg renders the video. World Labs Marble builds the worlds. SerpApi handles Lens, Search and News. Every model call goes through a provider interface, so tests run on fakes without API keys.

## Challenges we ran into

- **Interview latency.** Muse Spark is a reasoning model. At its default effort, picking the next question took about 15 seconds, which is a long, awkward silence when you're talking to your grandmother. Dropping `reasoning_effort` to `minimal` brought it to about 3 seconds, and the questions were just as good. We kept higher effort for the post-interview stages, where quality matters more than speed.
- **Muse Voice Transcribe isn't OpenAI-compatible.** We wrote a custom multipart client and split its multi-sentence turns into sentences inside each turn's time span, so every sentence still maps to the right moment in the audio.
- **3D worlds from close-ups don't work.** Marble is great at spaces and bad at objects. A text-only prompt for a story set in a store gave us a grey warehouse with a giant melted product in it. A single wide photo of the actual place gave us something recognizable. So we never send the close-up of the heirloom. We find a real photo of the place instead and credit its source.
- **Keeping slow jobs off the hot path.** World generation takes about five minutes and video rendering is CPU-heavy. Both run in a separate worker lane with their own concurrency limits, and no job holds a database connection while it waits on an external API. Our Supabase pooler caps at 15 connections, and we learned that the hard way.

## Accomplishments that we're proud of

- **Provenance-first storytelling.** You can tap almost any sentence and hear the person who said it. As far as we know, no other storytelling app does this. It's what makes the page feel like your grandmother's story and not an AI's version of it.
- **We held our own line on voices.** No cloning, no TTS of the relative, and every piece of AI narration is labeled and cites its sources. That was a product choice, and it made the app feel more trustworthy.
- **The full loop works live on a phone:** photo, analysis, voice interview with real follow-ups, a cited story, and a second phone adding a memory that shows up in real time.
- **It's built to last past the weekend:** RLS on every table, generated TypeScript types from the Pydantic models, a test suite that runs on fake providers, and desktop and mobile browser checks.

## What we learned

- The best AI feature in a family app is a good question. Most of the emotional value came from follow-ups like "Who was S?", not from the polished prose.
- Constraints make the product better. "Never speak as the relative" shut down a lot of flashy ideas and made everything we kept feel more honest.
- Picking the right reasoning effort for each call mattered more for user experience than picking the model.
- Generative 3D needs real context. One honest photo of a place beats any amount of prompt engineering.

## What's next for Tell Me More

- **Ask Muse about your family.** A Muse connector so you can ask "What did Grandpa say about his watch?" and get an answer that links to his own recording.
- **More languages.** Many of the stories we most want to save are told in Nepali, Hindi, Spanish or Tagalog. We kept v1 English-only so the provenance guarantees stay solid, and multilingual interviews are the next big step.
- **Life lessons and traditions.** Recordings that aren't tied to an object, such as recipes, advice and holiday rituals, collected on a family calendar.
- **Printed keepsakes.** A bound book of a family's objects and their stories, with QR codes that play the original voices.

## Built with

`react` `typescript` `vite` `tailwindcss` `three.js` `python` `fastapi` `uv` `pydantic` `postgresql` `supabase` `meta-muse-spark` `muse-voice-transcribe` `muse-image` `serpapi` `google-lens` `world-labs` `gemini` `ffmpeg` `pixabay` `playwright`
