import { useMutation, useQuery, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import {
  Avatar,
  Button,
  Card,
  Chip,
  ErrorState,
  FormError,
  Header,
  HandLink,
  Loading,
  Notice,
  ScreenBody,
  TextButton,
} from '@/components/ui/chrome'
import { api, type Schemas } from '@/lib/api'
import { formatApiError } from '@/lib/apiError'
import { useLiveQuery } from '@/lib/realtime'
import { useScreenTitle } from '@/lib/useScreenTitle'
import { isOpen, statusWord } from '@/routes/capture/data'

type Action = 'accept' | 'decline' | 'cancel'

/** One story request: the storyteller answers it here; the person who asked follows it here. */
export function RequestDetail() {
  useScreenTitle('story request')
  const { requestId } = useParams() as { requestId: string }
  const navigate = useNavigate()
  const qc = useQueryClient()
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
  useLiveQuery('story_request', `id=eq.${requestId}`, ['request', requestId])

  const act = useMutation({
    mutationFn: async (kind: Action) => {
      const path = { request_id: requestId }
      const res =
        kind === 'accept'
          ? await api.POST('/api/requests/{request_id}/accept', { params: { path } })
          : kind === 'decline'
            ? await api.POST('/api/requests/{request_id}/decline', { params: { path } })
            : await api.POST('/api/requests/{request_id}/cancel', { params: { path } })
      if (res.error) throw new Error(formatApiError(res.error, "that didn't work. try again."))
      return kind
    },
    onSuccess: (kind) => {
      qc.invalidateQueries({ queryKey: ['request', requestId] })
      qc.invalidateQueries({ queryKey: ['requests'] })
      if (kind === 'accept') navigate(`/answer/${requestId}`)
    },
  })

  const r = detail.data
  if (detail.isLoading)
    return (
      <ScreenBody screen="story-request">
        <Header title="story request" back="/requests" />
        <Loading />
      </ScreenBody>
    )
  if (!r)
    return (
      <ScreenBody screen="story-request">
        <Header title="story request" back="/requests" />
        <ErrorState message={detail.error?.message} onRetry={() => detail.refetch()} />
      </ScreenBody>
    )

  // The API resolves the viewer in the request's own family; the active family can be a different one.
  return r.viewer_role === 'storyteller' ? (
    <Incoming r={r} act={act} />
  ) : (
    <Outgoing r={r} act={act} canCancel={r.viewer_role === 'listener'} />
  )
}

type Act = UseMutationResult<Action, Error, Action>

function ObjectPhoto({ r }: { r: Schemas['RequestDetail'] }) {
  const src = r.capture_url ?? r.heirloom_cover_url
  if (!src) return null
  return (
    <div className="hand-box mx-auto aspect-square w-3/4 overflow-hidden border-2 border-ink">
      <img src={src} alt={r.heirloom_title ?? 'the object'} className="size-full object-cover" />
    </div>
  )
}

/** Screen 13 style: someone wants to hear the storyteller's story. */
function Incoming({ r, act }: { r: Schemas['RequestDetail']; act: Act }) {
  const asker = r.listener_name ?? 'someone'
  return (
    <ScreenBody screen="incoming-request">
      <Header title="a story request" back="/requests" />
      <div className="mb-4 flex items-center gap-3">
        <Avatar name={r.listener_name} />
        <p className="min-w-0 font-hand text-[1.7rem] leading-tight break-words">{asker} wants to know</p>
      </div>
      <ObjectPhoto r={r} />
      {r.heirloom_title && (
        <p className="mt-2 text-center font-sans text-[1.2rem] break-words text-muted">{r.heirloom_title}</p>
      )}
      {r.message && (
        <Card className="mt-4 text-center font-sans text-[1.35rem] leading-snug break-words">“{r.message}”</Card>
      )}
      <FormError>{act.error?.message}</FormError>
      {isOpen(r.status) ? (
        <div className="mt-auto flex flex-col gap-3 pt-6">
          {r.status === 'pending' ? (
            <Button onClick={() => act.mutate('accept')} disabled={act.isPending}>
              {act.isPending && act.variables === 'accept' ? 'one moment…' : 'tell the story →'}
            </Button>
          ) : (
            <Button to={`/answer/${r.id}`}>continue the story →</Button>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Button tone="secondary" to="/requests" className="px-3">
              later
            </Button>
            <Button tone="secondary" className="px-3" onClick={() => act.mutate('decline')} disabled={act.isPending}>
              i don't know
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-5 flex flex-col gap-3">
          <Notice>
            {r.status === 'completed'
              ? 'you told this story. thank you.'
              : r.status === 'declined'
                ? "you said you don't know this one."
                : `${asker} cancelled this request.`}
          </Notice>
          {r.status === 'completed' && <Button to={`/h/${r.heirloom_id}`}>open the story</Button>}
          <HandLink to="/requests">back to requests</HandLink>
        </div>
      )}
    </ScreenBody>
  )
}

/** The person who asked: where the request stands, and what to do next. */
function Outgoing({ r, act, canCancel }: { r: Schemas['RequestDetail']; act: Act; canCancel: boolean }) {
  const [confirming, setConfirming] = useState(false)
  const teller = r.storyteller_name ?? 'they'
  const line: Record<string, string> = {
    pending: `waiting for ${teller} to answer.`,
    in_progress: `${teller} said yes and is telling the story.`,
    completed: `${teller} told the story.`,
    declined: `${teller} doesn't know this one. try asking someone else.`,
    cancelled: 'this request was cancelled.',
  }
  return (
    <ScreenBody screen="request-detail">
      <Header title="request status" back="/requests" />
      <ObjectPhoto r={r} />
      {r.heirloom_title && (
        <p className="mt-2 text-center font-hand text-[1.6rem] leading-tight break-words">{r.heirloom_title}</p>
      )}
      <Card className="mt-4 flex items-center gap-3">
        <Avatar name={r.storyteller_name} />
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
          <span className="font-sans text-[1.25rem] leading-tight break-words">
            {canCancel ? `you asked ${r.storyteller_name ?? 'a relative'}` : `${r.listener_name ?? 'someone'} asked ${r.storyteller_name ?? 'a relative'}`}
          </span>
          <Chip tone={r.status === 'completed' ? 'sun' : 'plain'}>{statusWord(r.status)}</Chip>
        </div>
      </Card>
      {r.message && (
        <p className="mt-3 border-l-4 border-ink pl-3 font-sans text-[1.25rem] leading-snug break-words">“{r.message}”</p>
      )}
      <p className="mt-4 font-sans text-[1.2rem] leading-snug break-words">{line[r.status] ?? line.pending}</p>
      <FormError>{act.error?.message}</FormError>
      <div className="mt-auto flex flex-col gap-3 pt-6">
        {r.status === 'completed' && <Button to={`/h/${r.heirloom_id}`}>open the story</Button>}
        {(r.status === 'declined' || r.status === 'cancelled') && (
          <Button to={`/choose/${r.heirloom_id}`}>ask someone else</Button>
        )}
        <Button tone={r.status === 'completed' || !isOpen(r.status) ? 'secondary' : 'primary'} to="/">
          home
        </Button>
        {canCancel && isOpen(r.status) &&
          (confirming ? (
            <Notice title="cancel this request?">
              {teller} won't be asked anymore.
              <div className="mt-2 flex gap-6">
                <TextButton onClick={() => act.mutate('cancel')} disabled={act.isPending}>
                  {act.isPending ? 'cancelling…' : 'yes, cancel'}
                </TextButton>
                <TextButton onClick={() => setConfirming(false)}>keep it</TextButton>
              </div>
            </Notice>
          ) : (
            <TextButton onClick={() => setConfirming(true)}>cancel request</TextButton>
          ))}
      </div>
    </ScreenBody>
  )
}
