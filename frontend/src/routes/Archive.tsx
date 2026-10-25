import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { BigButton, ScreenHeader } from '@/components/ui/Screen'
import { api, putToSignedUrl, type Schemas } from '@/lib/api'
import { clearCapture, getCapture, type Capture } from '@/lib/captureStore'
import { useFamily } from '@/lib/family'
import { videoFrame } from '@/lib/videoFrame'

const POLL_MS = 1500
const READ_TIMEOUT_MS = 45_000

type Phase =
  | { name: 'uploading' }
  | { name: 'reading' }
  | { name: 'matched'; candidates: Schemas['Candidate'][] }
  | { name: 'unreadable' } // saved, but the photo couldn't be read, so nothing to compare
  | { name: 'failed' } // the upload itself failed

/**
 * Brief §3D: save the capture, then check it against the family's saved objects. Matches come
 * from comparing what the AI saw in this photo with each saved object (heirlooms /matches).
 */
export function Archive() {
  const navigate = useNavigate()
  const { data: family } = useFamily()
  const [phase, setPhase] = useState<Phase>({ name: 'uploading' })
  const [heirloomId, setHeirloomId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function run() {
      const cap = getCapture()
      if (!cap || !family) return setPhase({ name: 'failed' })
      let id: string
      try {
        id = await save(family.id, cap)
      } catch {
        if (!cancelled) setPhase({ name: 'failed' })
        return
      }
      if (cancelled) return
      setHeirloomId(id)
      setPhase({ name: 'reading' })
      const deadline = Date.now() + READ_TIMEOUT_MS
      while (!cancelled && Date.now() < deadline) {
        const { data } = await api.GET('/api/heirlooms/{heirloom_id}/matches', {
          params: { path: { heirloom_id: id } },
        })
        if (data?.status === 'ready') return setPhase({ name: 'matched', candidates: data.candidates ?? [] })
        if (data?.status === 'failed') return setPhase({ name: 'unreadable' })
        await new Promise((r) => setTimeout(r, POLL_MS))
      }
      if (!cancelled) setPhase({ name: 'unreadable' })
    }
    run()
    return () => {
      cancelled = true
    }
  }, [family])

  async function sameAs(c: Schemas['Candidate']) {
    await api.POST('/api/heirlooms/{heirloom_id}/same-as/{target_id}', {
      params: { path: { heirloom_id: heirloomId!, target_id: c.heirloom.id } },
    })
    clearCapture()
    if (c.open_request_id) navigate(`/requests/${c.open_request_id}`)
    else if (c.has_story) navigate(`/h/${c.heirloom.id}`)
    else navigate(`/choose/${c.heirloom.id}`)
  }

  function askSomeone() {
    clearCapture()
    navigate(`/choose/${heirloomId}`)
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
      <ScreenHeader title="Search archive" />
      {(phase.name === 'uploading' || phase.name === 'reading') && (
        <>
          <p className="font-serif text-2xl">
            {phase.name === 'uploading' ? 'Saving your photo…' : 'Looking for this object in your family’s stories…'}
          </p>
          <div className="h-2 overflow-hidden rounded bg-ink/10">
            <div className="h-full w-1/2 animate-pulse bg-ink/40" />
          </div>
        </>
      )}
      {phase.name === 'failed' && (
        <>
          <p className="font-serif text-2xl">Saving failed.</p>
          <p className="text-muted">Check your connection and try again.</p>
          <BigButton onClick={() => window.location.reload()} primary>
            Try again
          </BigButton>
          <BigButton to="/capture">Back to camera</BigButton>
        </>
      )}
      {phase.name === 'unreadable' && (
        <>
          <p className="font-serif text-2xl">We saved it, but couldn’t compare it.</p>
          <p className="text-muted">The photo couldn’t be read clearly, so it’s a new object for now.</p>
          <BigButton onClick={askSomeone} primary>
            Choose who might know it
          </BigButton>
        </>
      )}
      {phase.name === 'matched' && phase.candidates.length === 0 && (
        <>
          <p className="font-serif text-2xl">No match found.</p>
          <p className="text-muted">It’s saved as a new object.</p>
          <BigButton onClick={askSomeone} primary>
            Choose who might know it
          </BigButton>
        </>
      )}
      {phase.name === 'matched' && phase.candidates.length > 0 && (
        <>
          <p className="font-serif text-2xl">
            {phase.candidates.length === 1 ? 'Is this the same object?' : 'Is it one of these?'}
          </p>
          {phase.candidates.map((c) => (
            <div key={c.heirloom.id} className="flex flex-col gap-3 rounded-xl bg-white p-4 shadow">
              {c.heirloom.cover_url && <img src={c.heirloom.cover_url} className="rounded-lg" alt="" />}
              <p className="font-serif text-xl">{c.heirloom.title ?? 'Untitled'}</p>
              <p className="text-sm text-muted">
                {c.open_request_id ? 'A story request is pending' : c.has_story ? 'Has a story' : 'No story yet'}
              </p>
              <BigButton onClick={() => sameAs(c)} primary>
                Yes, this one
              </BigButton>
            </div>
          ))}
          <BigButton onClick={askSomeone}>None of these — it’s new</BigButton>
        </>
      )}
    </main>
  )
}

/** Creates the object from the capture. A video sends a still for the AI and keeps the video. */
async function save(familyId: string, cap: Capture): Promise<string> {
  const still = cap.kind === 'video' ? await videoFrame(cap.blob) : cap.blob
  const created = (
    await api.POST('/api/heirlooms', {
      body: { family_id: familyId, photo_mime: still.type || 'image/jpeg' },
    })
  ).data!
  await putToSignedUrl(created.upload_url, still)
  await api.POST('/api/heirlooms/{heirloom_id}/photos/{media_id}/complete', {
    params: { path: { heirloom_id: created.heirloom_id, media_id: created.media_id } },
  })
  if (cap.kind === 'video') {
    const media = (
      await api.POST('/api/heirlooms/{heirloom_id}/media', {
        params: { path: { heirloom_id: created.heirloom_id } },
        body: { mime: cap.mime.split(';')[0] || 'video/webm' },
      })
    ).data!
    await putToSignedUrl(media.upload_url, cap.blob)
  }
  return created.heirloom_id
}
