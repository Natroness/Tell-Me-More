import { useMutation, useQuery } from '@tanstack/react-query'
import { Mic } from 'lucide-react'
import { useNavigate, useParams } from 'react-router'
import { LiveWaveform, Thumb } from '@/components/story/parts'
import {
  Avatar,
  Button,
  Card,
  ErrorState,
  FormError,
  Header,
  HandLink,
  Loading,
  Notice,
  ScreenBody,
} from '@/components/ui/chrome'
import { api } from '@/lib/api'
import { formatApiError } from '@/lib/apiError'
import { useScreenTitle } from '@/lib/useScreenTitle'
import type { InterviewState } from '@/routes/Interview'

/**
 * Screen 14 for a story request: who is asking and what, then the real interview with recorded
 * audio, live captions and AI follow-up questions. Finishing it writes the story, completes the
 * request and tells the person who asked.
 */
export function RecordStory() {
  useScreenTitle('tell the story')
  const { requestId } = useParams() as { requestId: string }
  const navigate = useNavigate()

  const detail = useQuery({
    queryKey: ['request', requestId],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/requests/{request_id}', {
        params: { path: { request_id: requestId } },
      })
      if (error || !data) throw new Error(formatApiError(error, 'we could not find this request.'))
      return data
    },
  })
  const r = detail.data

  const start = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST('/api/interviews', {
        body: { heirloom_id: r!.heirloom_id, narrator_id: r!.storyteller_id, request_id: requestId },
      })
      if (error || !data) throw new Error(formatApiError(error, 'we could not start. try again.'))
      return data
    },
    onSuccess: (started) => {
      const state: InterviewState = { requestId, asker: r?.listener_name, message: r?.message }
      navigate(`/interview/${started.interview.id}`, { state })
    },
  })

  if (detail.isLoading)
    return (
      <ScreenBody screen="record-story">
        <Header title="tell the story" />
        <Loading />
      </ScreenBody>
    )
  if (!r)
    return (
      <ScreenBody screen="record-story">
        <Header title="tell the story" />
        <ErrorState message={detail.error?.message} onRetry={() => detail.refetch()} />
      </ScreenBody>
    )

  const open = r.status === 'pending' || r.status === 'in_progress'
  const asker = r.listener_name ?? 'someone'
  const object = r.heirloom_title ?? 'this object'

  return (
    <ScreenBody screen="record-story" className="gap-4">
      <Header title="tell the story" />
      <div className="flex items-start gap-3">
        <Thumb src={r.capture_url ?? r.heirloom_cover_url} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="flex items-center gap-2 font-sans text-[1.1rem] leading-snug break-words text-muted">
            <Avatar name={r.listener_name} size="sm" />
            <span className="min-w-0 break-words">{asker} wants to know</span>
          </p>
          <p className="font-hand text-[1.9rem] leading-tight break-words">
            {r.message ? `“${r.message}”` : `tell us about ${object}`}
          </p>
        </div>
      </div>

      {open ? (
        <>
          <Card className="flex items-center gap-3">
            <LiveWaveform active={false} />
            <span className="shrink-0 font-sans text-[1.3rem] tabular-nums">0:00</span>
          </Card>
          <p className="font-sans text-[1.15rem] leading-snug text-muted">
            just talk. you'll hear one question at a time, and your own voice is kept with the story.
          </p>
          <FormError>{start.error?.message}</FormError>
          <div className="mt-auto flex flex-col gap-3 pt-4">
            <Button onClick={() => start.mutate()} disabled={start.isPending}>
              <Mic className="size-7" strokeWidth={2.2} aria-hidden />
              {start.isPending ? 'getting ready…' : 'start recording'}
            </Button>
            <HandLink to="/requests">later</HandLink>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-3">
          <Notice>
            {r.status === 'completed'
              ? 'this story has been told. thank you.'
              : r.status === 'declined'
                ? "you said you don't know this one."
                : `${asker} cancelled this request.`}
          </Notice>
          <Button to={`/h/${r.heirloom_id}`}>open the object</Button>
          <HandLink to="/requests">back to requests</HandLink>
        </div>
      )}
    </ScreenBody>
  )
}
