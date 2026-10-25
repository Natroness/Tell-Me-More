# Goals — Family Object Stories (Brief → Implementation)

Source: `Family Object Stories — UI Workflow & Implementation Brief.md`
Existing base: Tell Me More / Lorebook (`docs/DESIGN.md`, FastAPI + Vite + Supabase).

## G0 — Ground truth (done)
- [x] Read brief, DESIGN.md, routers, routes, migration, Claude Code sessions
- [x] Claude Code history: scaffold → 8 pipeline stages → latency + streaming ASR → e2e 276s → 28 tests pass. No commits yet.

## G1 — Listener Home (Brief §3A)
- [ ] Heading "Discover an object's story", prominent "Open camera"
- [ ] Destinations: Family stories, My requests, Tell a story, Notifications
- [ ] Camera prominent in all display modes

## G2 — Capture (Brief §3B)
- [x] Photo capture (exists, basic)
- [ ] Photo/Video mode switch (default Photo), Capture/Stop, Switch camera, Upload instead, Back
- [ ] Video audio, elapsed timer, recording indicator, 60s configurable limit
- [ ] Permission handling: camera denied → guidance + Upload; mic denied → explain + Photo mode

## G3 — Review capture (Brief §3C)
- [ ] Photo / playable video preview with sound, heading "Can you see the object clearly?"
- [ ] Retake, Use photo/video, full replay, blur/poor-lighting flag (or manual review fallback)

## G4 — Search family archive (Brief §3D)
- [ ] Upload → save media record → search → loading "Looking for this object's story…"
- [ ] One match → "Is this the same object?"; several → list + None of these
- [ ] Confirmed with pending request → open status; confirmed without story → storyteller select
- [ ] No match → create object + storyteller select; Search failed → Try again / Request anyway

## G5 — Choose storyteller (Brief §3E)
- [ ] Heading "Who might know its story?", large name+photo cards
- [ ] Object preview + selected relative + optional message + Send request
- [ ] No family connected → Invite + preserve capture

## G6 — Request confirmation (Brief §3F)
- [ ] Only after save; heading "Story requested", message "We've asked Grandpa…"
- [ ] Buttons Back home / View request; stays pending on leave

## G7 — Story playback (Brief §3G)
- [x] Basic StoryView exists (title, blocks, quotes tap-to-play, sticky audio)
- [ ] Object title+image, storyteller name, video OR image+audio
- [ ] Play/pause, progress, volume, captions/transcript, Ask a follow-up
- [ ] AI summary separate + approved; photo/people/memory blocks (currently TODO → null)

## G8 — Storyteller workflow (Brief §4, H–J)
- [ ] H: Notification "wants to hear about your X", large image/capture, message, Tell story / Later / I don't know
- [ ] I: Default audio, video alt; prompt "Tell us about this object"; image + Start + timer + pause/resume + Finish; follow-ups one-at-a-time (Who gave it… / When… / What makes it special…) with Answer/Skip
- [ ] J: Playback review, editable title + 1–2 sentence description + dates/people/place; Share / Record again / Save draft; on share → save, link object+request, completed, notify; success "Your story has been shared with X"

## G9 — Display modes (Brief §5)
- [ ] Onboarding: age slider + handle + numeric/plus-minus alt
- [ ] <18 Regular, 18–50 Simplified, 50+ Extra simple; Settings → Display mode; "Use simpler screens" offer
- [ ] Extra-simple: large labeled buttons, plain language, 1 Q/screen, Back+Home visible, no gesture-only actions, Read more, visible recording controls

## G10 — Data model (Brief §6)
- [x] family, person, heirloom(object), media, interview, turn, segment, fact, context_card, memory_note, story, job
- [ ] User profile: age, ui_mode, avatar_url (person extension or profile table)
- [ ] StoryRequest: id, object_id, capture_media_id, listener_id, storyteller_id, message, status (pending/in_progress/completed/declined/cancelled)
- [ ] Story: add request_id?, storyteller_id, recording_media_id, description, transcript, status (draft/published)
- [ ] Media: upload_status (uploading/ready/failed), duration
- [ ] Notification: recipient_id, type, request_id, story_id, read_at
- [ ] RLS + Realtime for new tables

## G11 — Reliability (Brief §7)
- [ ] Preserve drafts/captures on navigate; upload progress + retry; idempotent taps
- [ ] In-app notifications when push off; My requests status; resume drafts; archive restricted to family
- [ ] Delivery failure → keep request + retry separately; decline → choose another; short errors + next action
- [ ] Label demo vs real clearly

## G12 — MVP acceptance (Brief §9, 14 items)
- [ ] Photo capture+review; video+audio replay; retake no-request; known object → story
- [ ] Reject match → new request; unknown → send to storyteller; confirmation+pending
- [ ] Storyteller open+view; record/review/draft/publish; publish completes+notifies
- [ ] Listener plays story; same object found again; failure recovery paths; 3 modes full workflow

## Current snapshot
Backend: 6 routers, 8 stages working, 28 tests. Missing: requests/notifications/user-prefs routers.
Frontend: 7 routes (Shelf, Capture basic, Heirloom, Interview, Family, PublicStory, AuthGate). Missing: ~10 screens + display-mode system.
