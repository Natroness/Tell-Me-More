import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Box, ExternalLink, Film } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router'
import { AudioPlayer, Button, Card, Chip, Disclosure, FormError, Notice, SourceTag } from '@/components/ui/chrome'
import { api, type Schemas } from '@/lib/api'
import { formatApiError } from '@/lib/apiError'
import { buzz, HAPTIC } from '@/lib/haptics'
import { useLiveQuery } from '@/lib/realtime'

type VideoStatus = NonNullable<Schemas['StorytimeVideo']['status']>
type WorldStatus = Schemas['WorldSummary']['status']

const VIDEO_STEPS: VideoStatus[] = ['queued', 'scripting', 'gathering', 'narrating', 'rendering']
const VIDEO_WORDS: Record<VideoStatus, string> = {
  queued: 'waiting to start',
  scripting: 'planning the scenes',
  gathering: 'finding pictures',
  narrating: 'recording the narration',
  rendering: 'putting the video together',
  ready: 'ready',
  failed: "didn't finish",
}
const WORLD_STEPS: WorldStatus[] = [
  'queued',
  'writing_scene',
  'finding_reference',
  'generating',
  'saving',
  'placing_spots',
]
const WORLD_WORDS: Record<WorldStatus, string> = {
  queued: 'waiting to start',
  writing_scene: 'imagining the scene',
  finding_reference: 'preparing a picture of the place',
  generating: 'building the world',
  saving: 'saving the world',
  placing_spots: 'placing the memories',
  ready: 'ready',
  failed: "didn't finish",
}
const POLL_MS = 5000

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 font-hand text-[1.6rem] leading-tight">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  )
}

function Progress({ step, total, label }: { step: number; total: number; label: string }) {
  return (
    <div className="flex flex-col gap-2" role="status">
      <p className="font-sans text-[1.15rem]">{label}…</p>
      <div className="flex gap-1.5" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={`h-2.5 flex-1 rounded-full border-[1.5px] border-ink ${i <= step ? 'bg-sun' : ''}`} />
        ))}
      </div>
    </div>
  )
}

/**
 * Optional narrated "storytime" video, secondary to the original recordings. Hidden entirely when
 * the feature is off. `publicKey` switches to the shared-link endpoint (finished videos only).
 */
export function StorytimeSection({ heirloomId, publicKey }: { heirloomId: string; publicKey?: string }) {
  const qc = useQueryClient()
  const key = ['storytime', heirloomId, publicKey ?? null]
  const wasWorking = useRef(false)
  const video = useQuery({
    queryKey: key,
    queryFn: async () => {
      const path = { heirloom_id: heirloomId }
      const res =
        publicKey != null
          ? await api.GET('/api/public/stories/{heirloom_id}/storytime', { params: { path, query: { k: publicKey } } })
          : await api.GET('/api/stories/{heirloom_id}/storytime', { params: { path } })
      if (res.response.status === 404) return null
      if (res.error || !res.data) throw new Error(formatApiError(res.error, "the video didn't load."))
      return res.data
    },
    refetchInterval: (q) => {
      const s = q.state.data?.status
      return s && s !== 'ready' && s !== 'failed' ? POLL_MS : false
    },
  })
  const available = useQuery({
    queryKey: ['storytime-available'],
    enabled: publicKey == null && !!video.data?.can_manage,
    queryFn: async () => (await api.GET('/api/storytime/available')).data?.available ?? false,
  })
  useLiveQuery('storytime', `heirloom_id=eq.${heirloomId}`, key)
  useEffect(() => {
    const status = video.data?.status
    if (status === 'ready' && wasWorking.current) buzz(HAPTIC.start)
    wasWorking.current = !!status && VIDEO_STEPS.includes(status)
  }, [video.data?.status])
  const create = useMutation({
    mutationFn: async () => {
      buzz(HAPTIC.start)
      const { data, error } = await api.POST('/api/stories/{heirloom_id}/storytime', {
        params: { path: { heirloom_id: heirloomId } },
      })
      if (error || !data) throw new Error(formatApiError(error, "we couldn't start the video. try again."))
      return data
    },
    onSuccess: (data) => qc.setQueryData(key, data),
  })
  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE('/api/stories/{heirloom_id}/storytime', {
        params: { path: { heirloom_id: heirloomId } },
      })
      if (error) throw new Error(formatApiError(error, "we couldn't remove the video. try again."))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  })

  const v = video.data
  if (!v || video.isError) return null
  const status = v.status
  const working = status != null && status !== 'ready' && status !== 'failed'
  const canCreate = v.can_manage && available.data === true && !working
  if (!v.video_url && !working && !canCreate && status !== 'failed') return null

  return (
    <Section icon={<Film className="size-6" strokeWidth={2.2} aria-hidden />} title="storytime video">
      <p className="font-sans text-[1.05rem] leading-snug text-muted">
        a short retelling with pictures and the storyteller's own voice, usually 30–75 seconds.
        takes a few minutes to make; you can leave and come back.
      </p>
      {v.video_url && (
        <div className="hand-box overflow-hidden border-2 border-ink">
          <video src={v.video_url} poster={v.poster_url ?? undefined} controls playsInline preload="metadata" className="w-full" />
        </div>
      )}
      {v.video_url && v.stale && !working && (
        <Notice>the story has changed since this video was made.</Notice>
      )}
      {working && (
        <Progress
          step={VIDEO_STEPS.indexOf(status)}
          total={VIDEO_STEPS.length}
          label={v.video_url ? `making a new version: ${VIDEO_WORDS[status]}` : VIDEO_WORDS[status]}
        />
      )}
      {status === 'failed' && <Notice tone="error">{v.error ?? "the last video didn't finish."}</Notice>}
      {canCreate && (
        <Button tone="secondary" onClick={() => create.mutate()} disabled={create.isPending || remove.isPending}>
          {create.isPending
            ? 'starting…'
            : !v.video_url && status !== 'failed'
              ? 'create a storytime video'
              : status === 'failed'
                ? 'try the video again'
                : 'make a new version'}
        </Button>
      )}
      {v.id && v.can_manage && publicKey == null && (
        <Button tone="secondary" onClick={() => remove.mutate()} disabled={remove.isPending || create.isPending}>
          {remove.isPending ? 'removing…' : 'remove video'}
        </Button>
      )}
      <FormError>{create.error?.message ?? remove.error?.message}</FormError>
      {v.credits && v.credits.length > 0 && (
        <Disclosure summary="picture credits">
          <ul className="flex flex-col gap-1">
            {v.credits.map((c, i) => (
              <li key={`${c.page_url}-${i}`} className="break-words">
                <a href={c.page_url} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                  {c.photographer}
                </a>{' '}
                on{' '}
                <a href={c.license_url} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                  {c.provider ?? 'Pixabay'}
                </a>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </Section>
  )
}

/** A walkable world imagined from the story's photo. Hidden when the feature is off. */
export function ImmersiveSection({
  heirloomId,
  publicKey,
  canCreate,
}: {
  heirloomId: string
  publicKey?: string
  canCreate?: boolean
}) {
  const qc = useQueryClient()
  const key = ['immersive', heirloomId, publicKey ?? null]
  const photos = useQuery({
    queryKey: key,
    queryFn: async () => {
      const path = { heirloom_id: heirloomId }
      const res =
        publicKey != null
          ? await api.GET('/api/public/heirlooms/{heirloom_id}/immersive', { params: { path, query: { k: publicKey } } })
          : await api.GET('/api/heirlooms/{heirloom_id}/immersive', { params: { path } })
      if (res.response.status === 404) return null
      if (res.error || !res.data) throw new Error(formatApiError(res.error, "the 3d world didn't load."))
      return res.data
    },
    refetchInterval: (q) => {
      return q.state.data?.some((p) => p.world && p.world.status !== 'ready' && p.world.status !== 'failed')
        ? POLL_MS : false
    },
  })
  useLiveQuery('immersive_world', `heirloom_id=eq.${heirloomId}`, key)
  const photo = photos.data?.find((p) => p.world?.status === 'ready') ?? photos.data?.find((p) => p.is_cover) ?? photos.data?.[0]
  const world = photo?.world
  const detail = useQuery({
    queryKey: ['immersive-world', world?.id, publicKey ?? null],
    enabled: world?.status === 'ready',
    queryFn: async () => {
      const res =
        publicKey != null
          ? await api.GET('/api/public/immersive/{world_id}', { params: { path: { world_id: world!.id }, query: { k: publicKey } } })
          : await api.GET('/api/immersive/{world_id}', { params: { path: { world_id: world!.id } } })
      return res.data ?? null
    },
  })
  const create = useMutation({
    mutationFn: async (mediaId: string) => {
      const { data, error } = await api.POST('/api/heirlooms/{heirloom_id}/photos/{media_id}/immersive', {
        params: { path: { heirloom_id: heirloomId, media_id: mediaId } },
      })
      if (error || !data) throw new Error(formatApiError(error, "we couldn't start the world. try again."))
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  })

  if (!photo || photos.isError) return null
  const status = world?.status
  const working = status != null && status !== 'ready' && status !== 'failed'
  const allowCreate = canCreate && publicKey == null && (!world || status === 'failed')
  if (!working && status !== 'ready' && !allowCreate) return null
  const w = detail.data

  return (
    <Section icon={<Box className="size-6" strokeWidth={2.2} aria-hidden />} title="3d world">
      {status === 'ready' ? (
        <>
          {world?.thumbnail_url && (
            <div className="hand-box overflow-hidden border-2 border-ink">
              <img src={world.thumbnail_url} alt="" className="w-full object-cover" />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <SourceTag kind="inference" />
            {w && <span className="font-sans text-[1.05rem] leading-snug break-words text-muted">{w.label.toLowerCase()}</span>}
          </div>
          <Link
            to={
              publicKey != null
                ? `/s/${heirloomId}/w/${world!.id}?k=${encodeURIComponent(publicKey)}`
                : `/w/${world!.id}`
            }
            className="hand-pill flex min-h-16 w-full items-center justify-center gap-2 border-2 border-ink bg-sun px-6 py-3 text-center font-sans text-[1.6rem] leading-none text-black"
          >
            walk through this memory →
          </Link>
          {w?.assets.pano && (
            <a
              href={w.assets.pano}
              target="_blank"
              rel="noreferrer"
              className="hand-pill flex min-h-16 w-full items-center justify-center gap-2 border-2 border-ink bg-paper px-6 py-3 text-center font-sans text-[1.6rem] leading-none"
            >
              open the 360° view <ExternalLink className="size-5" aria-hidden />
            </a>
          )}
          {w && w.spots.length > 0 && <WorldSpots world={w} />}
        </>
      ) : working ? (
        <Progress step={WORLD_STEPS.indexOf(status)} total={WORLD_STEPS.length} label={WORLD_WORDS[status]} />
      ) : (
        <>
          {status === 'failed' && <Notice tone="error">the last world didn't finish.</Notice>}
          <p className="font-sans text-[1.05rem] leading-snug text-muted">
            imagine the place in this story as a world you can look around. it is made from the story's words, not a real
            photograph.
          </p>
          <Button tone="secondary" onClick={() => create.mutate(photo.media_id)} disabled={create.isPending}>
            {create.isPending ? 'starting…' : status === 'failed' ? 'try the world again' : 'make a 3d world'}
          </Button>
        </>
      )}
      <FormError>{create.error?.message}</FormError>
    </Section>
  )
}

function WorldSpots({ world }: { world: Schemas['ImmersiveWorld'] }) {
  return (
    <Disclosure summary="memories inside the world">
      <ul className="flex flex-col gap-4">
        {world.spots.map((s) => (
          <li key={s.id} className="flex flex-col gap-2">
            <Card className="flex flex-col gap-2 p-3">
              <p className="font-hand text-[1.3rem] leading-tight break-words">{s.label}</p>
              {s.facts.map((f) => (
                <p key={f.id} className="break-words">
                  {f.text}
                </p>
              ))}
              {s.segments.map((seg) => (
                <div key={seg.id} className="flex flex-col gap-1">
                  <p className="break-words text-muted">“{seg.text}”</p>
                  <AudioPlayer src={seg.audio_url} startMs={seg.start_ms} durationMs={seg.end_ms - seg.start_ms} label="hear this moment" />
                </div>
              ))}
              {world.narrator && s.segments.length > 0 && <Chip>{world.narrator}'s voice</Chip>}
            </Card>
          </li>
        ))}
      </ul>
    </Disclosure>
  )
}
