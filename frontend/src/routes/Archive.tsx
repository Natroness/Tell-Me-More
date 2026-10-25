import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  Button,
  Disclosure,
  EmptyState,
  FormError,
  Header,
  Loading,
  Notice,
  ScreenBody,
  SourceTag,
} from '@/components/ui/chrome'
import { api, putToSignedUrl, type Schemas } from '@/lib/api'
import { formatApiError } from '@/lib/apiError'
import { clearCapture, getCapture, type Capture } from '@/lib/captureStore'
import { useFamily } from '@/lib/family'
import { useScreenTitle } from '@/lib/useScreenTitle'
import { cn } from '@/lib/utils'
import { videoFrame } from '@/lib/videoFrame'

const POLL_MS = 1500
const READ_TIMEOUT_MS = 45_000

type Saved = { heirloomId: string; mediaId: string }

type Phase =
  | { name: 'missing' }
  | { name: 'uploading' }
  | { name: 'reading' }
  | { name: 'slow' } // still being read after the timeout
  | { name: 'matched'; candidates: Schemas['Candidate'][] }
  | { name: 'unreadable' } // saved, but the photo couldn't be read, so nothing to compare
  | { name: 'failed' } // the upload itself failed

/** One save per capture, so re-renders and "keep waiting" never create a second object. */
const saving = new WeakMap<Capture, Promise<Saved>>()

/**
 * Screens 08–09: save the capture, then check it against the family's saved objects. Matches
 * come from comparing what the AI saw in this photo with each saved object (heirlooms /matches).
 */
export function Archive() {
  useScreenTitle('find its story')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: family, isLoading: familyLoading } = useFamily()
  const [cap] = useState(getCapture)
  const [phase, setPhase] = useState<Phase>(cap ? { name: 'uploading' } : { name: 'missing' })
  const [saved, setSaved] = useState<Saved | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [picked, setPicked] = useState(0)

  useEffect(() => {
    if (!cap || familyLoading) return
    let cancelled = false
    async function run() {
      if (!family) return setPhase({ name: 'failed' })
      setPhase({ name: 'uploading' })
      let s: Saved
      try {
        let p = saving.get(cap!)
        if (!p) {
          p = save(family.id, cap!)
          saving.set(cap!, p)
          p.catch(() => saving.delete(cap!))
        }
        s = await p
      } catch {
        if (!cancelled) setPhase({ name: 'failed' })
        return
      }
      if (cancelled) return
      setSaved(s)
      setPhase({ name: 'reading' })
      const deadline = Date.now() + READ_TIMEOUT_MS
      while (!cancelled && Date.now() < deadline) {
        const { data } = await api.GET('/api/heirlooms/{heirloom_id}/matches', {
          params: { path: { heirloom_id: s.heirloomId } },
        })
        if (cancelled) return
        if (data?.status === 'ready') return setPhase({ name: 'matched', candidates: data.candidates ?? [] })
        if (data?.status === 'failed') return setPhase({ name: 'unreadable' })
        await new Promise((r) => setTimeout(r, POLL_MS))
      }
      if (!cancelled) setPhase({ name: 'slow' })
    }
    run()
    return () => {
      cancelled = true
    }
  }, [cap, family, familyLoading, attempt])

  const detail = useQuery({
    queryKey: ['heirloom', saved?.heirloomId],
    enabled: !!saved && (phase.name === 'matched' || phase.name === 'unreadable'),
    queryFn: async () =>
      (await api.GET('/api/heirlooms/{heirloom_id}', {
        params: { path: { heirloom_id: saved!.heirloomId } },
      })).data,
  })

  const merge = useMutation({
    mutationFn: async (c: Schemas['Candidate']) => {
      const { error } = await api.POST('/api/heirlooms/{heirloom_id}/same-as/{target_id}', {
        params: { path: { heirloom_id: saved!.heirloomId, target_id: c.heirloom.id } },
      })
      if (error) throw new Error(formatApiError(error, 'we could not link it. try again.'))
      return c
    },
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['heirlooms'] })
      clearCapture()
      if (c.open_request_id) navigate(`/requests/${c.open_request_id}`)
      else if (c.has_story) navigate(`/h/${c.heirloom.id}`)
      else navigate(`/choose/${c.heirloom.id}`, { state: { captureMediaId: saved!.mediaId } })
    },
  })

  function askSomeone() {
    qc.invalidateQueries({ queryKey: ['heirlooms'] })
    clearCapture()
    navigate(`/choose/${saved!.heirloomId}`)
  }

  if (phase.name === 'missing')
    return (
      <ScreenBody screen="find-its-story">
        <Header title="find its story" back="/capture" />
        <EmptyState title="no photo to look for" action={<Button to="/capture">open camera</Button>}>
          take a photo of the object first.
        </EmptyState>
      </ScreenBody>
    )

  if (phase.name === 'uploading' || phase.name === 'reading')
    return (
      <ScreenBody screen="find-its-story">
        <Header title="looking for its story…" back="/" />
        <CapturePreview cap={cap!} className="mx-auto w-2/3" />
        <Loading label={phase.name === 'uploading' ? 'saving your photo…' : 'reading the photo and checking your family’s objects…'} />
      </ScreenBody>
    )

  if (phase.name === 'failed')
    return (
      <ScreenBody screen="find-its-story">
        <Header title="find its story" back="/review" />
        <CapturePreview cap={cap!} className="mx-auto w-2/3" />
        <Notice tone="error" title="saving failed" className="mt-5">
          check your connection and try again. your photo is still here.
        </Notice>
        <div className="mt-auto flex flex-col gap-3 pt-6">
          <Button onClick={() => setAttempt((n) => n + 1)}>try again</Button>
          <Button tone="secondary" to="/capture">
            back to camera
          </Button>
        </div>
      </ScreenBody>
    )

  if (phase.name === 'slow')
    return (
      <ScreenBody screen="find-its-story">
        <Header title="still looking…" back="/" />
        <CapturePreview cap={cap!} className="mx-auto w-2/3" />
        <Notice title="this is taking longer than usual" className="mt-5">
          your photo is saved. you can keep waiting, or ask someone about it now.
        </Notice>
        <div className="mt-auto flex flex-col gap-3 pt-6">
          <Button onClick={() => setAttempt((n) => n + 1)}>keep waiting</Button>
          <Button tone="secondary" onClick={askSomeone}>
            ask who might know
          </Button>
        </div>
      </ScreenBody>
    )

  if (phase.name === 'unreadable' || phase.candidates.length === 0)
    return (
      <ScreenBody screen="find-its-story">
        <Header title={phase.name === 'unreadable' ? 'we saved it' : 'a new object'} back="/" />
        <CapturePreview cap={cap!} className="mx-auto w-2/3" />
        {phase.name === 'unreadable' ? (
          <Notice title="we couldn't read the photo clearly" className="mt-5">
            so we couldn't compare it with your family's objects. it's saved as a new object.
          </Notice>
        ) : (
          <p className="mt-5 text-center font-sans text-[1.3rem] leading-snug">
            nothing like it in your family's stories yet. it's saved as a new object.
          </p>
        )}
        <Noticed detail={detail.data} className="mt-4" />
        <div className="mt-auto flex flex-col gap-3 pt-6">
          <Button onClick={askSomeone}>who might know? →</Button>
          {phase.name === 'unreadable' && (
            <Button tone="secondary" to="/capture">
              take another photo
            </Button>
          )}
        </div>
      </ScreenBody>
    )

  const { candidates } = phase
  const chosen = candidates[Math.min(picked, candidates.length - 1)]
  const noun = chosen.heirloom.category && chosen.heirloom.category !== 'other' ? chosen.heirloom.category : 'object'

  return (
    <ScreenBody screen="confirm-object">
      <Header title={candidates.length === 1 ? `is this the same ${noun}?` : 'is it one of these?'} back="/" />
      <div className="grid grid-cols-2 gap-3">
        <figure className="flex flex-col gap-1.5">
          <CapturePreview cap={cap!} />
          <figcaption className="text-center font-sans text-[1.1rem]">your photo</figcaption>
        </figure>
        {candidates.map((c, i) => (
          <button
            key={c.heirloom.id}
            type="button"
            onClick={() => setPicked(i)}
            aria-pressed={chosen === c}
            className="flex flex-col gap-1.5 text-center"
          >
            <span
              className={cn(
                'hand-box relative block aspect-square overflow-hidden border-2 border-ink',
                chosen === c && candidates.length > 1 && 'ring-4 ring-sun',
              )}
            >
              {c.heirloom.cover_url && <img src={c.heirloom.cover_url} alt="" className="size-full object-cover" />}
              {chosen === c && candidates.length > 1 && (
                <span className="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-full border-2 border-ink bg-sun text-black">
                  <Check className="size-4" strokeWidth={3} aria-hidden />
                </span>
              )}
            </span>
            <span className="font-sans text-[1.1rem] leading-snug break-words">{c.heirloom.title ?? 'saved object'}</span>
          </button>
        ))}
      </div>
      <p className="mt-4 text-center font-sans text-[1.2rem] leading-snug break-words">
        {chosen.open_request_id
          ? 'someone has already been asked about it.'
          : chosen.has_story
            ? 'it already has a story.'
            : 'no one has told its story yet.'}
      </p>
      <Disclosure summary="more details" className="mt-4">
        <div className="flex flex-col gap-3">
          <p className="flex flex-col gap-1">
            <SourceTag kind="inference" />
            <span className="break-words">
              {candidates.length === 1 ? 'it ' : `“${chosen.heirloom.title ?? 'this one'}” `}
              {chosen.confidence >= 0.85 ? 'looks very much like' : 'might be'} an object your family saved before.
            </span>
          </p>
          <NoticedList detail={detail.data} />
        </div>
      </Disclosure>
      <FormError>{merge.error?.message}</FormError>
      <div className="mt-auto flex flex-col gap-3 pt-6">
        <Button onClick={() => merge.mutate(chosen)} disabled={merge.isPending}>
          {merge.isPending ? 'linking…' : 'yes, this one'}
        </Button>
        <Button tone="secondary" onClick={askSomeone} disabled={merge.isPending}>
          none of these
        </Button>
      </div>
    </ScreenBody>
  )
}

function CapturePreview({ cap, className }: { cap: Capture; className?: string }) {
  return (
    <div className={cn('hand-box aspect-square overflow-hidden border-2 border-ink', className)}>
      {cap.kind === 'photo' ? (
        <img src={cap.previewUrl} alt="your photo of the object" className="size-full object-cover" />
      ) : (
        <video src={cap.previewUrl} muted playsInline className="size-full object-cover" />
      )}
    </div>
  )
}

/** What the AI made of the new photo, one tap away. */
function Noticed({ detail, className }: { detail?: Schemas['HeirloomDetail']; className?: string }) {
  if (!detail || (!detail.heirloom.title && detail.observations.length === 0 && detail.seed_questions.length === 0))
    return null
  return (
    <Disclosure summary="what we noticed" className={className}>
      <NoticedList detail={detail} />
    </Disclosure>
  )
}

function NoticedList({ detail }: { detail?: Schemas['HeirloomDetail'] }) {
  if (!detail) return null
  const { heirloom, observations, seed_questions } = detail
  return (
    <div className="flex flex-col gap-3">
      {heirloom.title && (
        <div className="flex flex-col gap-1">
          <SourceTag kind="inference" />
          <p className="break-words">
            your photo looks like {heirloom.title}
            {heirloom.category && heirloom.category !== 'other' && !heirloom.title.toLowerCase().includes(heirloom.category)
              ? ` (${heirloom.category})`
              : ''}
            .
          </p>
        </div>
      )}
      {observations.length > 0 && (
        <div className="flex flex-col gap-1">
          <SourceTag kind="observation" />
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {observations.map((o) => (
              <li key={o.id} className="break-words">
                {o.text}
              </li>
            ))}
          </ul>
        </div>
      )}
      {seed_questions.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="font-hand text-[1.3rem] leading-tight">questions to ask</p>
          <ul className="flex flex-col gap-1 border-l-2 border-dashed border-ink/50 pl-3 text-muted">
            {seed_questions.map((q) => (
              <li key={q} className="break-words">
                {q}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** Creates the object from the capture. A video sends a still for the AI and keeps the video. */
async function save(familyId: string, cap: Capture): Promise<Saved> {
  const still = cap.kind === 'video' ? await videoFrame(cap.blob) : cap.blob
  const { data: created, error } = await api.POST('/api/heirlooms', {
    body: { family_id: familyId, photo_mime: still.type || 'image/jpeg' },
  })
  if (error || !created) throw new Error('could not create')
  await putToSignedUrl(created.upload_url, still)
  const done = await api.POST('/api/heirlooms/{heirloom_id}/photos/{media_id}/complete', {
    params: { path: { heirloom_id: created.heirloom_id, media_id: created.media_id } },
  })
  if (done.error) throw new Error('could not finish upload')
  if (cap.kind === 'video') {
    const { data: media, error: mediaError } = await api.POST('/api/heirlooms/{heirloom_id}/media', {
      params: { path: { heirloom_id: created.heirloom_id } },
      body: { mime: cap.mime.split(';')[0] || 'video/webm' },
    })
    if (mediaError || !media) throw new Error('could not add video')
    await putToSignedUrl(media.upload_url, cap.blob)
  }
  return { heirloomId: created.heirloom_id, mediaId: created.media_id }
}
