import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { clearDraft, readDraft, writeDraft } from '@/components/story/draft'
import { Thumb, textareaClass } from '@/components/story/parts'
import {
  AudioPlayer,
  Button,
  Card,
  Chip,
  ErrorState,
  FormError,
  Header,
  Loading,
  Notice,
  ScreenBody,
} from '@/components/ui/chrome'
import { api } from '@/lib/api'
import { formatApiError } from '@/lib/apiError'
import { useLiveQuery } from '@/lib/realtime'
import { useScreenTitle } from '@/lib/useScreenTitle'

/** Screen 15: hear it back, add a line about it, then open the shared story. */
export function ReviewShare() {
  useScreenTitle('review and share')
  const { heirloomId } = useParams() as { heirloomId: string }
  const [search] = useSearchParams()
  const requestId = search.get('request')
  const narratorId = search.get('narrator')
  const navigate = useNavigate()
  const [description, setDescription] = useState(() => readDraft(heirloomId)?.description ?? '')
  const [saved, setSaved] = useState(false)

  const detail = useQuery({
    queryKey: ['heirloom', heirloomId],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/heirlooms/{heirloom_id}', {
        params: { path: { heirloom_id: heirloomId } },
      })
      if (error || !data) throw new Error(formatApiError(error, 'we could not open this object.'))
      return data
    },
  })
  const hasStory = detail.data?.latest_story_version != null
  const story = useQuery({
    queryKey: ['story', heirloomId],
    enabled: hasStory,
    queryFn: async () => {
      const { data, error } = await api.GET('/api/stories/{heirloom_id}', {
        params: { path: { heirloom_id: heirloomId } },
      })
      if (error || !data) throw new Error(formatApiError(error, 'we could not load the story.'))
      return data
    },
  })
  const request = useQuery({
    queryKey: ['request', requestId],
    enabled: !!requestId,
    queryFn: async () =>
      (await api.GET('/api/requests/{request_id}', { params: { path: { request_id: requestId! } } })).data ?? null,
  })
  useLiveQuery('job', `subject_id=eq.${heirloomId}`, ['heirloom', heirloomId])
  useLiveQuery('story', `heirloom_id=eq.${heirloomId}`, ['story', heirloomId])

  const share = useMutation({
    mutationFn: async () => {
      if (description.trim()) {
        const { error } = await api.POST('/api/heirlooms/{heirloom_id}/memories', {
          params: { path: { heirloom_id: heirloomId } },
          body: { text: description.trim().slice(0, 2000) },
        })
        if (error) throw new Error(formatApiError(error, "couldn't save your description. try again."))
      }
      if (requestId && request.data?.status === 'pending') {
        await api.POST('/api/requests/{request_id}/accept', { params: { path: { request_id: requestId } } })
      }
    },
    onSuccess: () => {
      clearDraft(heirloomId)
      navigate(`/h/${heirloomId}`)
    },
  })

  const openRequest = request.data && (request.data.status === 'pending' || request.data.status === 'in_progress')
  const again = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST('/api/interviews', {
        body: { heirloom_id: heirloomId, narrator_id: narratorId!, request_id: openRequest ? requestId : null },
      })
      if (error || !data) throw new Error(formatApiError(error, 'we could not start. try again.'))
      return data
    },
    onSuccess: (r) => navigate(`/interview/${r.interview.id}`, { state: { requestId: openRequest ? requestId : undefined } }),
  })

  if (detail.isLoading)
    return (
      <ScreenBody screen="review-share">
        <Header title="review and share" />
        <Loading />
      </ScreenBody>
    )
  if (!detail.data)
    return (
      <ScreenBody screen="review-share">
        <Header title="review and share" />
        <ErrorState message={detail.error?.message} onRetry={() => detail.refetch()} />
      </ScreenBody>
    )

  const { heirloom } = detail.data
  const s = story.data
  const title = s?.title ?? heirloom.title ?? 'your story'

  return (
    <ScreenBody screen="review-share" className="gap-4">
      <Header title="review and share" />
      <Card className="flex items-center gap-3 p-3">
        <Thumb src={heirloom.cover_url} />
        <p className="min-w-0 flex-1 font-hand text-[1.6rem] leading-tight break-words">{title}</p>
      </Card>

      <label className="flex flex-col gap-1.5">
        <span className="font-sans text-[1.25rem]">add a short description</span>
        <textarea
          value={description}
          onChange={(e) => {
            setDescription(e.target.value)
            setSaved(false)
          }}
          rows={3}
          maxLength={2000}
          placeholder="a sentence or two in your own words (optional)"
          className={textareaClass}
        />
      </label>

      {s && s.recordings.length > 0 ? (
        <section className="flex flex-col gap-2" aria-label="your recording">
          {s.recordings.map((r, i) => (
            <div key={r.turn_id} className="flex flex-col gap-1">
              {s.recordings.length > 1 && r.question && (
                <p className="font-sans text-[1.05rem] leading-snug break-words text-muted">{r.question}</p>
              )}
              <AudioPlayer src={r.audio_url} durationMs={r.duration_ms} label={i === 0 ? 'play your recording' : 'play this answer'} />
            </div>
          ))}
          <div>
            <Chip tone="sun">original voice</Chip>
          </div>
        </section>
      ) : story.error ? (
        <ErrorState message={story.error.message} onRetry={() => story.refetch()} />
      ) : (
        <Notice title="writing your story…">
          your recording is saved. it will play here as soon as the story is written — usually within a minute.
        </Notice>
      )}

      <FormError>{share.error?.message || again.error?.message}</FormError>
      {saved && <Notice tone="success">draft saved on this phone.</Notice>}

      <div className="mt-auto flex flex-col gap-3 pt-4">
        <Button onClick={() => share.mutate()} disabled={share.isPending}>
          {share.isPending ? 'sharing…' : 'share story →'}
        </Button>
        <div className="grid grid-cols-2 gap-3">
          <Button
            tone="secondary"
            className="px-3"
            onClick={() => {
              writeDraft(heirloomId, { description, requestId })
              setSaved(true)
            }}
            disabled={!description.trim()}
          >
            save draft
          </Button>
          {narratorId ? (
            <Button tone="secondary" className="px-3" onClick={() => again.mutate()} disabled={again.isPending}>
              {again.isPending ? 'one moment…' : 'record again'}
            </Button>
          ) : (
            <Button tone="secondary" className="px-3" to={`/h/${heirloomId}`}>
              record again
            </Button>
          )}
        </div>
      </div>
    </ScreenBody>
  )
}
