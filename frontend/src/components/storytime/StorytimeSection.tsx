import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { api, type Schemas } from '@/lib/api'
import { buzz, HAPTIC } from '@/lib/haptics'

const tap = () => buzz(HAPTIC.start)
import { useLiveQuery } from '@/lib/realtime'

type Video = Schemas['StorytimeVideo']
const progress: Record<string, string> = {
  queued: 'Getting ready…',
  scripting: 'Writing the script…',
  gathering: 'Gathering pictures…',
  narrating: 'Recording the narration…',
  rendering: 'Putting it together…',
}

function message(error: unknown) {
  const detail = (error as { detail?: unknown })?.detail
  return typeof detail === 'string' ? detail : 'That didn’t work. Please try again.'
}

function Player({ video }: { video: Video }) {
  if (!video.video_url) return null
  return (
    <section aria-label="Storytime video" className="rounded-xl border border-ink/15 bg-white p-4">
      <h2 className="font-serif text-2xl">Storytime</h2>
      <p className="mb-3 text-sm text-muted">AI narration, with the storyteller’s original voice.</p>
      {video.stale && (
        <p className="mb-3 rounded-lg bg-ink/5 px-3 py-2 text-sm">Made from an earlier version</p>
      )}
      <video
        key={video.video_url.split('?')[0]}
        controls playsInline preload="metadata"
        poster={video.poster_url ?? undefined}
        className="aspect-video w-full rounded-lg bg-ink"
      >
        <source src={video.video_url} type="video/mp4" />
        Your browser could not play this video. <a href={video.video_url}>Download it here.</a>
      </video>
      <p className="mt-2 text-sm text-muted">English captions are included in the video.</p>
      {(video.credits ?? []).length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer py-2">Picture credits</summary>
          <ul className="space-y-2">
            {(video.credits ?? []).map((credit, i) => (
              <li key={`${credit.asset_id}-${i}`}>
                <a href={credit.page_url} target="_blank" rel="noreferrer" className="underline">
                  Photo by {credit.photographer} on {credit.provider}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

function MemberStorytime({ heirloomId }: { heirloomId: string }) {
  const qc = useQueryClient()
  const key = ['storytime', heirloomId]
  const ready = useRef(false)
  const availability = useQuery({
    queryKey: ['storytime-available'],
    queryFn: async () => (await api.GET('/api/storytime/available')).data?.available ?? false,
    staleTime: 60_000,
  })
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const r = await api.GET('/api/stories/{heirloom_id}/storytime', {
        params: { path: { heirloom_id: heirloomId } },
      })
      if (r.response.status === 404) return null
      if (r.error) throw new Error(message(r.error))
      return r.data ?? null
    },
    refetchInterval: (q) => q.state.data?.status && progress[q.state.data.status] ? 5000 : false,
    staleTime: 30_000,
  })
  useLiveQuery('storytime', `heirloom_id=eq.${heirloomId}`, key)
  useEffect(() => {
    if (query.data?.status === 'ready' && ready.current) tap()
    ready.current = !!query.data?.status && !!progress[query.data.status]
  }, [query.data?.status])
  const create = useMutation({
    mutationFn: async () => {
      tap()
      const r = await api.POST('/api/stories/{heirloom_id}/storytime', {
        params: { path: { heirloom_id: heirloomId } },
      })
      if (r.error) throw new Error(message(r.error))
      return r.data
    },
    onSuccess: (data) => qc.setQueryData(key, data),
  })
  const remove = useMutation({
    mutationFn: async () => {
      const r = await api.DELETE('/api/stories/{heirloom_id}/storytime', {
        params: { path: { heirloom_id: heirloomId } },
      })
      if (r.error) throw new Error(message(r.error))
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: key }) },
  })
  const video = query.data
  const working = video?.status ? progress[video.status] : null
  const busy = create.isPending || remove.isPending
  const error = create.error ?? remove.error
  if (!video) return null
  return (
    <div className="space-y-3">
      <Player video={video} />
      {video.can_manage && (availability.data || video.id) && (
        <section className="rounded-xl border border-ink/15 bg-white p-4" aria-label="Make a Storytime video">
          {working ? (
            <p role="status" aria-live="polite">{working} You can leave and come back.</p>
          ) : (
            <>
              <h2 className="font-serif text-xl">
                {video.video_url ? 'A video for the family' : 'Make a Storytime video for the family?'}
              </h2>
              <p className="mt-2 text-muted">A short retelling with pictures and their own voice, usually 30–75 seconds. Takes a few minutes to make; you can leave.</p>
              {video.status === 'failed' && <p role="alert" className="mt-2 text-red-900">{video.error ?? 'The video could not be finished.'}</p>}
              {availability.data && (
                <button disabled={busy} onClick={() => create.mutate()}
                  className="mt-3 rounded-xl bg-ink px-5 py-3 text-paper disabled:opacity-50">
                  {create.isPending ? 'Starting…' : video.status === 'failed' ? 'Retry' : video.video_url ? 'Regenerate' : 'Create'}
                </button>
              )}
            </>
          )}
          {video.id && (
            <button disabled={busy} onClick={() => remove.mutate()}
              className="ml-3 mt-3 rounded-xl border border-ink/20 px-4 py-3 disabled:opacity-50">
              {remove.isPending ? 'Removing…' : 'Remove video'}
            </button>
          )}
          {error && <p role="alert" className="mt-2 text-red-900">{error.message}</p>}
        </section>
      )}
    </div>
  )
}

function PublicStorytime({ heirloomId, publicKey }: { heirloomId: string; publicKey: string }) {
  const query = useQuery({
    queryKey: ['public-storytime', heirloomId, publicKey],
    queryFn: async () => (await api.GET('/api/public/stories/{heirloom_id}/storytime', {
      params: { path: { heirloom_id: heirloomId }, query: { k: publicKey } },
    })).data ?? null,
    staleTime: 60_000,
  })
  return query.data ? <Player video={query.data} /> : null
}

export function StorytimeSection({ heirloomId, publicKey }: { heirloomId: string; publicKey?: string }) {
  return publicKey !== undefined
    ? <PublicStorytime heirloomId={heirloomId} publicKey={publicKey} />
    : <MemberStorytime heirloomId={heirloomId} />
}
