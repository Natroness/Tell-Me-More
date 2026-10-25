import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Button, ErrorState, FormError, Header, Loading, Notice, ScreenBody } from '@/components/ui/chrome'
import { api } from '@/lib/api'
import { formatApiError } from '@/lib/apiError'
import { useFamily } from '@/lib/family'
import { useProfile } from '@/lib/profile'
import { useScreenTitle } from '@/lib/useScreenTitle'
import { cn } from '@/lib/utils'
import {
  errorText,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS,
  memoryKey,
  PHOTO_TYPES,
  uploadToMemory,
  useMemory,
  type Memory,
} from './data'

type Item = {
  key: string
  preview: string
  file?: File
  mediaId?: string
  status: 'uploading' | 'done' | 'failed' | 'removing'
  error?: string
  retryable?: boolean
}

/** Screen 25, starting a new memory. The draft is created when the first photo is picked. */
export function NewMemory() {
  useScreenTitle('choose photos')
  const family = useFamily()
  if (family.isLoading) return <ScreenBody><Header title="choose photos" back="/memories" /><Loading /></ScreenBody>
  if (family.isError || !family.data)
    return (
      <ScreenBody>
        <Header title="choose photos" back="/memories" />
        <ErrorState
          message={family.isError ? family.error.message : 'join or start a family before adding memories.'}
          onRetry={() => family.refetch()}
        />
      </ScreenBody>
    )
  return <PhotoPicker familyId={family.data.id} />
}

/** Screen 25 again, for the photos of an existing draft or memory. */
export function EditPhotos() {
  useScreenTitle('choose photos')
  const { memoryId } = useParams() as { memoryId: string }
  const memory = useMemory(memoryId)
  if (memory.isLoading) return <ScreenBody><Header title="choose photos" back="/memories" /><Loading /></ScreenBody>
  if (memory.isError || !memory.data)
    return (
      <ScreenBody>
        <Header title="choose photos" back="/memories" />
        <ErrorState message={memory.error?.message} onRetry={() => memory.refetch()} />
      </ScreenBody>
    )
  return <PhotoPicker key={memoryId} familyId={memory.data.family_id} initial={memory.data} />
}

function mimeOf(file: File) {
  if (file.type) return file.type.toLowerCase()
  if (/\.heic$/i.test(file.name)) return 'image/heic'
  if (/\.heif$/i.test(file.name)) return 'image/heif'
  return ''
}

function PhotoPicker({ familyId, initial }: { familyId: string; initial?: Memory }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const inputId = useId()
  const language = useProfile().data?.preferred_language
  const [items, setItems] = useState<Item[]>(
    () => initial?.photos.map((p) => ({ key: p.id, preview: p.url, mediaId: p.id, status: 'done' as const })) ?? [],
  )
  const [note, setNote] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const memoryId = useRef(initial?.id)
  const creating = useRef<Promise<string> | null>(null)
  const idempotency = useRef(crypto.randomUUID())
  const previews = useRef<string[]>([])

  useEffect(() => {
    const urls = previews.current
    return () => urls.forEach((u) => URL.revokeObjectURL(u))
  }, [])

  const update = (key: string, patch: Partial<Item>) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)))

  async function ensureMemory() {
    if (memoryId.current) return memoryId.current
    creating.current ??= (async () => {
      const { data, error } = await api.POST('/api/families/{family_id}/memories', {
        params: { path: { family_id: familyId } },
        body: { language: language ?? 'en', idempotency_key: idempotency.current },
      })
      if (error || !data) throw new Error(formatApiError(error, 'we could not start this memory.'))
      memoryId.current = data.id
      qc.invalidateQueries({ queryKey: ['memories'] })
      return data.id
    })()
    try {
      return await creating.current
    } catch (e) {
      creating.current = null
      throw e
    }
  }

  async function upload(item: Item) {
    if (!item.file) return
    update(item.key, { status: 'uploading', error: undefined })
    try {
      const id = await ensureMemory()
      const { mediaId } = await uploadToMemory(id, 'photo', item.file, {
        mediaId: item.mediaId,
        onMediaId: (m) => update(item.key, { mediaId: m }),
      })
      update(item.key, { status: 'done', mediaId })
    } catch (e) {
      update(item.key, { status: 'failed', error: errorText(e, 'that photo did not upload.'), retryable: true })
    }
  }

  function pick(files: FileList | null) {
    if (!files?.length) return
    const room = MAX_PHOTOS - items.length
    const chosen = [...files].slice(0, Math.max(0, room))
    setNote(files.length > room ? `a memory can hold up to ${MAX_PHOTOS} photos.` : null)
    const added = chosen.map((f): Item => {
      const mime = mimeOf(f)
      const file = f.type ? f : new File([f], f.name, { type: mime })
      const preview = URL.createObjectURL(f)
      previews.current.push(preview)
      const key = crypto.randomUUID()
      if (!PHOTO_TYPES.includes(mime))
        return { key, preview, status: 'failed', error: 'use a jpg, png, webp, or heic photo.' }
      if (f.size > MAX_PHOTO_BYTES)
        return { key, preview, status: 'failed', error: 'this photo is bigger than 15 MB.' }
      return { key, preview, file, status: 'uploading' }
    })
    setItems((prev) => [...prev, ...added])
    added.filter((it) => it.status === 'uploading').forEach(upload)
  }

  async function remove(item: Item) {
    if (!item.mediaId || !memoryId.current) {
      setItems((prev) => prev.filter((it) => it.key !== item.key))
      return
    }
    const before = item.status
    update(item.key, { status: 'removing', error: undefined })
    const { error, response } = await api.DELETE('/api/memories/{memory_id}/media/{media_id}', {
      params: { path: { memory_id: memoryId.current, media_id: item.mediaId } },
    })
    if (error && response.status !== 404) {
      update(item.key, { status: before, error: formatApiError(error, 'we could not remove that photo.') })
      return
    }
    setItems((prev) => prev.filter((it) => it.key !== item.key))
  }

  function move(index: number, by: -1 | 1) {
    setItems((prev) => {
      const next = [...prev]
      const [it] = next.splice(index, 1)
      next.splice(index + by, 0, it)
      return next
    })
  }

  async function next() {
    const id = memoryId.current
    if (!id) return
    setSaving(true)
    setSaveError(null)
    try {
      const got = await api.GET('/api/memories/{memory_id}', { params: { path: { memory_id: id } } })
      if (got.error || !got.data) throw new Error(formatApiError(got.error, 'we could not save your photos.'))
      let memory = got.data
      const server = memory.photos.map((p) => p.id)
      const local = items.flatMap((it) => (it.status === 'done' && it.mediaId && server.includes(it.mediaId) ? [it.mediaId] : []))
      const order = [...local, ...server.filter((s) => !local.includes(s))]
      if (order.length && order.join() !== server.join()) {
        const put = await api.PUT('/api/memories/{memory_id}/photos/order', {
          params: { path: { memory_id: id } },
          body: { media_ids: order },
        })
        if (put.error || !put.data) throw new Error(formatApiError(put.error, 'we could not save the photo order.'))
        memory = put.data
      }
      qc.setQueryData(memoryKey(id), memory)
      qc.invalidateQueries({ queryKey: ['memories'] })
      if (memory.recording) navigate(`/memories/${id}/edit`, { replace: !initial })
      else navigate(`/memories/${id}/record`, { replace: !initial })
    } catch (e) {
      setSaveError(errorText(e))
      setSaving(false)
    }
  }

  const busy = items.some((it) => it.status === 'uploading' || it.status === 'removing')
  const failed = items.some((it) => it.status === 'failed')
  const ready = items.filter((it) => it.status === 'done').length

  return (
    <ScreenBody screen="choose-photos">
      <Header title="choose photos" back={initial ? `/memories/${initial.id}/edit` : '/memories'} />
      <div className="flex flex-1 flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          {items.length < MAX_PHOTOS && (
            <label
              htmlFor={inputId}
              className="hand-box flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 border-2 border-dashed border-ink/60 text-center font-sans text-[1.3rem] leading-tight focus-within:ring-2 focus-within:ring-sun"
            >
              <Plus className="size-9" strokeWidth={2.2} aria-hidden />
              add photos
              <input
                id={inputId}
                type="file"
                multiple
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  pick(e.target.files)
                  e.target.value = ''
                }}
              />
            </label>
          )}
          {items.map((it, i) => (
            <PhotoTile
              key={it.key}
              item={it}
              index={i}
              canMove={!busy && !saving}
              last={i === items.length - 1}
              onRemove={() => remove(it)}
              onRetry={() => upload(it)}
              onMove={(by) => move(i, by)}
            />
          ))}
        </div>
        {note && <Notice>{note}</Notice>}
        {items.length > 1 && (
          <p className="font-sans text-[1.1rem] leading-snug text-muted">the first photo is the cover. use the arrows to change the order.</p>
        )}
        {failed && !busy && <Notice>retry or remove the photos that did not upload.</Notice>}
        <FormError>{saveError}</FormError>
        <div className="mt-auto pt-2">
          <Button onClick={next} disabled={ready === 0 || busy || failed || saving}>
            {saving ? 'saving…' : busy ? 'uploading…' : 'next'}
            {!saving && !busy && <ArrowRight className="size-7" strokeWidth={2.4} />}
          </Button>
        </div>
      </div>
    </ScreenBody>
  )
}

function PhotoTile({
  item,
  index,
  canMove,
  last,
  onRemove,
  onRetry,
  onMove,
}: {
  item: Item
  index: number
  canMove: boolean
  last: boolean
  onRemove: () => void
  onRetry: () => void
  onMove: (by: -1 | 1) => void
}) {
  const round = 'grid size-10 place-items-center rounded-full border-2 border-ink bg-paper text-ink disabled:opacity-40'
  return (
    <div className="hand-box relative aspect-square overflow-hidden border-2 border-ink">
      <img src={item.preview} alt={`photo ${index + 1}`} className="size-full object-cover" />
      {item.status !== 'done' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-paper/80 p-2 text-center font-sans text-[1.05rem] leading-tight">
          {item.status === 'uploading' && <span>uploading…</span>}
          {item.status === 'removing' && <span>removing…</span>}
          {item.status === 'failed' && (
            <>
              <span className="break-words">{item.error ?? 'did not upload.'}</span>
              {item.retryable && (
                <button type="button" onClick={onRetry} className="min-h-10 px-2 underline underline-offset-4">
                  retry
                </button>
              )}
            </>
          )}
        </div>
      )}
      {item.status === 'done' && item.error && (
        <p className="absolute inset-x-0 top-12 bg-paper/90 px-2 py-1 text-center font-sans text-[1rem] leading-tight break-words">
          {item.error}
        </p>
      )}
      {item.status !== 'uploading' && item.status !== 'removing' && (
        <button type="button" onClick={onRemove} aria-label={`remove photo ${index + 1}`} className={cn(round, 'absolute top-1.5 right-1.5')}>
          <X className="size-5" strokeWidth={2.4} />
        </button>
      )}
      {item.status === 'done' && (
        <div className="absolute inset-x-1.5 bottom-1.5 flex items-center justify-between">
          <button type="button" onClick={() => onMove(-1)} disabled={!canMove || index === 0} aria-label="move earlier" className={round}>
            <ChevronLeft className="size-5" strokeWidth={2.4} />
          </button>
          {index === 0 && <span className="rounded-full border-2 border-ink bg-sun px-2 font-sans text-[0.95rem] text-black">cover</span>}
          <button type="button" onClick={() => onMove(1)} disabled={!canMove || last} aria-label="move later" className={round}>
            <ChevronRight className="size-5" strokeWidth={2.4} />
          </button>
        </div>
      )}
    </div>
  )
}
