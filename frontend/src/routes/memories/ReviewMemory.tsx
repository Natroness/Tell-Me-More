import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Mic } from 'lucide-react'
import { useId, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { AudioPlayer, Button, Card, ErrorState, FormError, Header, Loading, Notice, ScreenBody } from '@/components/ui/chrome'
import { TextField } from '@/components/ui/fields'
import { api } from '@/lib/api'
import { formatApiError } from '@/lib/apiError'
import { useScreenTitle } from '@/lib/useScreenTitle'
import { inputClass, memoryKey, useMemory, type Memory } from './data'
import { DeleteMemory, PhotoThumb } from './parts'

/** Screen 27: name it, date it, listen back, then share it with the family. */
export function ReviewMemory() {
  useScreenTitle('review memory')
  const { memoryId } = useParams() as { memoryId: string }
  const memory = useMemory(memoryId)
  if (memory.isLoading) return <ScreenBody><Header title="review memory" back="/memories" /><Loading /></ScreenBody>
  if (memory.isError || !memory.data)
    return (
      <ScreenBody>
        <Header title="review memory" back="/memories" />
        <ErrorState message={memory.error?.message} onRetry={() => memory.refetch()} />
      </ScreenBody>
    )
  return <ReviewForm key={memory.data.id} memory={memory.data} />
}

function ReviewForm({ memory }: { memory: Memory }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const dateId = useId()
  const descId = useId()
  const [title, setTitle] = useState(memory.title ?? '')
  const [date, setDate] = useState(memory.event_date ?? '')
  const [description, setDescription] = useState(memory.description ?? '')
  const id = memory.id
  const published = memory.status === 'published'
  const cover = memory.photos[0]

  const missing = [
    !title.trim() && 'add a title',
    memory.photos.length === 0 && 'add a photo',
    !memory.recording && 'record the story',
  ].filter(Boolean) as string[]

  async function saveFields() {
    if (title.trim().length > 120) throw new Error('keep the title under 120 characters.')
    const { data, error } = await api.PATCH('/api/memories/{memory_id}', {
      params: { path: { memory_id: id } },
      body: { title: title.trim() || null, event_date: date || null, description: description.trim() || null },
    })
    if (error || !data) throw new Error(formatApiError(error, 'we could not save your changes.'))
    qc.setQueryData(memoryKey(id), data)
    qc.invalidateQueries({ queryKey: ['memories'] })
    return data
  }

  const save = useMutation({
    mutationFn: saveFields,
    onSuccess: (saved) =>
      saved.status === 'published'
        ? navigate(`/memories/${id}`, { replace: true, state: { notice: 'changes saved.' } })
        : navigate('/memories', { state: { notice: 'draft saved.' } }),
  })

  const publish = useMutation({
    mutationFn: async () => {
      await saveFields()
      const { data, error } = await api.POST('/api/memories/{memory_id}/publish', {
        params: { path: { memory_id: id } },
      })
      if (error || !data) throw new Error(formatApiError(error, 'we could not share this memory.'))
      qc.setQueryData(memoryKey(id), data)
      qc.invalidateQueries({ queryKey: ['memories'] })
    },
    onSuccess: () =>
      navigate(`/memories/${id}`, { replace: true, state: { notice: 'shared with your family.' } }),
  })

  const pending = save.isPending || publish.isPending

  return (
    <ScreenBody screen="review-memory">
      <Header title="review memory" back={published ? `/memories/${id}` : '/memories'} />
      <form
        className="flex flex-1 flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (published) save.mutate()
          else publish.mutate()
        }}
      >
        <Link to={`/memories/${id}/photos`} className="relative block">
          <PhotoThumb src={cover?.url} className="aspect-[4/3] w-full" />
          <span className="absolute right-2 bottom-2 rounded-full border-2 border-ink bg-paper px-3 py-1 font-sans text-[1.05rem]">
            {memory.photos.length === 0
              ? 'add photos'
              : memory.photos.length === 1
                ? 'edit photos'
                : `${memory.photos.length} photos · edit`}
          </span>
        </Link>

        <TextField label="title" value={title} onChange={setTitle} />

        <div className="flex flex-col gap-1.5">
          <label htmlFor={dateId} className="font-sans text-[1.35rem] leading-none">
            when was it?
          </label>
          <input id={dateId} type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={descId} className="font-sans text-[1.35rem] leading-none">
            a few words <span className="text-muted">(optional)</span>
          </label>
          <textarea
            id={descId}
            value={description}
            maxLength={500}
            rows={3}
            onChange={(e) => setDescription(e.target.value)}
            className={`${inputClass} py-3 leading-snug`}
          />
        </div>

        {memory.recording ? (
          <AudioPlayer src={memory.recording.url} label="play your recording" />
        ) : (
          <Card tone="dashed" className="flex items-center gap-3">
            <Mic className="size-7 shrink-0" strokeWidth={2.2} aria-hidden />
            <p className="flex-1 font-sans text-[1.2rem] leading-snug">no recording yet</p>
          </Card>
        )}

        {!published && missing.length > 0 && (
          <Notice title="before you share it">
            <ul className="list-disc pl-5">
              {missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </Notice>
        )}

        <FormError>{publish.error?.message ?? save.error?.message}</FormError>

        <div className="mt-auto flex flex-col gap-3 pt-2">
          {published ? (
            <Button type="submit" disabled={pending || !title.trim()}>
              {save.isPending ? 'saving…' : 'save changes'}
            </Button>
          ) : (
            <>
              <Button type="submit" disabled={pending || missing.length > 0}>
                {publish.isPending ? 'sharing…' : 'publish'}
              </Button>
              <div className="grid grid-cols-2 gap-3">
                <Button tone="secondary" onClick={() => save.mutate()} disabled={pending} className="px-3 text-[1.4rem]">
                  {save.isPending ? 'saving…' : 'save draft'}
                </Button>
                <Button tone="secondary" to={`/memories/${id}/record`} disabled={pending} className="px-3 text-[1.4rem]">
                  {memory.recording ? 'record again' : 'record'}
                </Button>
              </div>
              <DeleteMemory memoryId={id} label="delete this draft" />
            </>
          )}
        </div>
      </form>
    </ScreenBody>
  )
}
