import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api, type Schemas } from '@/lib/api'

type Photo = Schemas['ImmersivePhoto']
type Status = NonNullable<Photo['world']>['status']

const BUILDING: Partial<Record<Status, string>> = {
  queued: 'Getting ready…',
  writing_scene: 'Writing the scene…',
  finding_reference: 'Finding photos of the place…',
  generating: 'Building the world (about 5 min)…',
  saving: 'Almost ready…',
  placing_spots: 'Almost ready…',
}

function since(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Overlaid on a story photo: make it a world, watch it build, or walk through it. */
export function ImmersiveButton({
  photo,
  heirloomId,
  publicKey,
}: {
  photo: Photo
  heirloomId: string
  publicKey?: string
}) {
  const qc = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [, tick] = useState(0)
  const world = photo.world
  const building = world ? BUILDING[world.status] : undefined

  useEffect(() => {
    if (!building) return
    const t = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [building])

  const create = useMutation({
    mutationFn: async () => {
      const r = await api.POST('/api/heirlooms/{heirloom_id}/photos/{media_id}/immersive', {
        params: { path: { heirloom_id: heirloomId, media_id: photo.media_id } },
      })
      if (r.error) {
        const detail = (r.error as { detail?: unknown }).detail
        throw new Error(typeof detail === 'string' ? detail : 'That didn’t work. Try again.')
      }
      return r.data
    },
    onSuccess: () => {
      setConfirming(false)
      void qc.invalidateQueries({ queryKey: ['immersive', heirloomId] })
    },
  })

  const chip = 'rounded-full bg-ink/85 px-4 py-3 text-base text-paper shadow backdrop-blur'

  if (world?.status === 'ready') {
    const to = publicKey
      ? `/s/${heirloomId}/w/${world.id}?k=${encodeURIComponent(publicKey)}`
      : `/w/${world.id}`
    return (
      <Link to={to} className={`${chip} inline-block font-semibold`}>
        Walk through this memory
      </Link>
    )
  }
  if (publicKey) return null
  if (building && world) {
    return (
      <p role="status" className={`${chip} inline-flex items-center gap-3`}>
        <span className="size-2.5 animate-pulse rounded-full bg-paper" />
        {building} <span className="tabular-nums opacity-80">{since(world.updated_at)}</span>
      </p>
    )
  }

  return (
    <>
      {world?.status === 'failed' ? (
        <div className={`${chip} inline-flex items-center gap-3`}>
          Couldn’t build this one.
          <button onClick={() => create.mutate()} className="underline" disabled={create.isPending}>
            Try again
          </button>
        </div>
      ) : (
        <button onClick={() => setConfirming(true)} className={chip}>
          Create immersive experience
        </button>
      )}
      {create.error && !confirming && (
        <p className="mt-2 rounded-lg bg-paper/95 px-3 py-2 text-sm text-red-900">
          {create.error.message}
        </p>
      )}
      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="immersive-title"
          className="fixed inset-0 z-30 flex items-end bg-ink/40"
          onClick={() => setConfirming(false)}
        >
          <div
            className="mx-auto w-full max-w-xl rounded-t-2xl bg-paper p-6 pb-10 text-ink shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="immersive-title" className="font-serif text-2xl">
              Step inside this memory
            </h2>
            <ul className="mt-4 flex list-disc flex-col gap-2 pl-5 text-lg">
              <li>It takes about 5 minutes. You can leave and come back.</li>
              <li>The place is imagined from the story. It is not a real photo.</li>
              <li>This photo is sent to World Labs to build the scene.</li>
            </ul>
            {create.error && <p className="mt-4 text-red-900">{create.error.message}</p>}
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => create.mutate()}
                disabled={create.isPending}
                className="flex-1 rounded-xl bg-ink px-4 py-4 text-lg text-paper disabled:opacity-50"
              >
                {create.isPending ? 'Starting…' : 'Create'}
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="rounded-xl border border-ink/20 px-4 py-4 text-lg"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
