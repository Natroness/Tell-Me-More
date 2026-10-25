import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Mic } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { clearDraft, readDraft, writeDraft } from '@/components/story/draft'
import { ObjectPhoto, textareaClass } from '@/components/story/parts'
import {
  Avatar,
  Button,
  Card,
  Disclosure,
  EmptyState,
  ErrorState,
  FormError,
  Header,
  Loading,
  Notice,
  ScreenBody,
  TextButton,
} from '@/components/ui/chrome'
import { api, type Schemas } from '@/lib/api'
import { formatApiError } from '@/lib/apiError'
import { useFamily } from '@/lib/family'
import { useScreenTitle } from '@/lib/useScreenTitle'
import { isOpen, useHeirlooms, usePeople, useRequests } from '@/routes/capture/data'

/** Screen 13: the next story someone asked you for. With none waiting, tell one on your own. */
export function Tell() {
  const [search, setSearch] = useSearchParams()
  const { data: family, isLoading: familyLoading, error: familyError, refetch } = useFamily()
  const incoming = useRequests(family?.id, 'incoming')
  const open = (incoming.data ?? []).filter((r) => isOpen(r.status))
  const wanted = search.get('request')
  const current = open.find((r) => r.id === wanted) ?? open[0]
  useScreenTitle(current ? 'a story request' : 'tell a story')

  if (familyLoading || incoming.isLoading)
    return (
      <ScreenBody screen="incoming-request">
        <Header title="tell a story" />
        <Loading />
      </ScreenBody>
    )
  if (familyError || incoming.error)
    return (
      <ScreenBody screen="incoming-request">
        <Header title="tell a story" />
        <ErrorState
          message={(familyError ?? incoming.error)?.message}
          onRetry={() => (familyError ? refetch() : incoming.refetch())}
        />
      </ScreenBody>
    )

  if (current) {
    const next = open[(open.indexOf(current) + 1) % open.length]
    return (
      <IncomingRequest
        key={current.id}
        requestId={current.id}
        remaining={open.length}
        onNext={next && next.id !== current.id ? () => setSearch({ request: next.id }) : undefined}
      />
    )
  }
  return <TellYourOwn familyId={family?.id} />
}

function IncomingRequest({
  requestId,
  remaining,
  onNext,
}: {
  requestId: string
  remaining: number
  onNext?: () => void
}) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const detail = useQuery({
    queryKey: ['request', requestId],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/requests/{request_id}', {
        params: { path: { request_id: requestId } },
      })
      if (error || !data) throw new Error(formatApiError(error, 'we could not load this request.'))
      return data
    },
  })
  const r = detail.data

  const tell = useMutation({
    mutationFn: async (req: Schemas['RequestDetail']) => {
      if (req.status !== 'pending') return
      const { error } = await api.POST('/api/requests/{request_id}/accept', {
        params: { path: { request_id: req.id } },
      })
      if (error) throw new Error(formatApiError(error, "that didn't work. try again."))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requests'] })
      navigate(`/answer/${requestId}`)
    },
  })
  const decline = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST('/api/requests/{request_id}/decline', {
        params: { path: { request_id: requestId } },
      })
      if (error) throw new Error(formatApiError(error, "that didn't work. try again."))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['request', requestId] })
      qc.invalidateQueries({ queryKey: ['requests'] })
    },
  })

  if (detail.isLoading)
    return (
      <ScreenBody screen="incoming-request">
        <Header title="a story request" />
        <Loading />
      </ScreenBody>
    )
  if (!r)
    return (
      <ScreenBody screen="incoming-request">
        <Header title="a story request" />
        <ErrorState message={detail.error?.message} onRetry={() => detail.refetch()} />
      </ScreenBody>
    )

  const asker = r.listener_name ?? 'someone'
  const busy = tell.isPending || decline.isPending
  return (
    <ScreenBody screen="incoming-request">
      <Header title="a story request" />
      <div className="mb-4 flex items-center gap-3">
        <Avatar name={r.listener_name} />
        <p className="min-w-0 font-hand text-[1.8rem] leading-tight break-words">{asker} wants to know</p>
      </div>
      <ObjectPhoto src={r.capture_url ?? r.heirloom_cover_url} alt={r.heirloom_title ?? undefined} className="w-4/5" />
      {r.heirloom_title && (
        <p className="mt-2 text-center font-sans text-[1.2rem] break-words text-muted">{r.heirloom_title}</p>
      )}
      <Card className="mt-4 text-center font-sans text-[1.35rem] leading-snug break-words">
        “{r.message || `tell me about your ${r.heirloom_title ?? 'object'}`}”
      </Card>
      <FormError>{tell.error?.message || decline.error?.message}</FormError>
      <div className="mt-auto flex flex-col gap-3 pt-6">
        <Button onClick={() => tell.mutate(r)} disabled={busy}>
          {tell.isPending ? 'one moment…' : 'tell the story →'}
        </Button>
        <div className="grid grid-cols-2 gap-3">
          <Button tone="secondary" to="/" className="px-3">
            later
          </Button>
          <Button tone="secondary" className="px-3" onClick={() => decline.mutate()} disabled={busy}>
            {decline.isPending ? 'one moment…' : "i don't know"}
          </Button>
        </div>
        {remaining > 1 && onNext && (
          <TextButton onClick={onNext}>
            {remaining - 1} more {remaining - 1 === 1 ? 'request' : 'requests'} waiting →
          </TextButton>
        )}
      </div>
    </ScreenBody>
  )
}

/** No one is waiting: record a story yourself, or write a memory down. */
function TellYourOwn({ familyId }: { familyId?: string }) {
  const navigate = useNavigate()
  const heirlooms = useHeirlooms(familyId)
  const { me } = usePeople(familyId)
  const [heirloomId, setHeirloomId] = useState('')
  const [text, setText] = useState('')
  const [saved, setSaved] = useState(false)

  const record = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST('/api/interviews', {
        body: { heirloom_id: heirloomId, narrator_id: me! },
      })
      if (error || !data) throw new Error(formatApiError(error, 'we could not start. try again.'))
      return data
    },
    onSuccess: (r) => navigate(`/interview/${r.interview.id}`),
  })
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST('/api/heirlooms/{heirloom_id}/memories', {
        params: { path: { heirloom_id: heirloomId } },
        body: { text },
      })
      if (error) throw new Error(formatApiError(error, "couldn't share. try again."))
    },
    onSuccess: () => {
      clearDraft(heirloomId)
      navigate(`/h/${heirloomId}`)
    },
  })

  const list = heirlooms.data ?? []
  const picked = list.find((h) => h.id === heirloomId)

  return (
    <ScreenBody screen="tell-a-story" className="gap-4">
      <Header title="tell a story" />
      <p className="font-sans text-[1.2rem] leading-snug text-muted">no one is waiting on a story right now. you can still tell one.</p>
      {heirlooms.isLoading ? (
        <Loading />
      ) : heirlooms.error ? (
        <ErrorState message={heirlooms.error.message} onRetry={() => heirlooms.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState
          title="no objects yet"
          action={<Button to="/capture">capture an object</Button>}
        >
          take a photo of something with a story first.
        </EmptyState>
      ) : (
        <>
          <p className="font-hand text-[1.7rem] leading-tight">which object?</p>
          <div className="grid grid-cols-3 gap-3">
            {list.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => {
                  setHeirloomId(h.id)
                  setSaved(false)
                  setText(readDraft(h.id)?.description ?? '')
                }}
                aria-pressed={h.id === heirloomId}
                className="flex flex-col items-center gap-1"
              >
                <ObjectPhoto
                  src={h.cover_url}
                  alt=""
                  className={h.id === heirloomId ? 'border-sun ring-4 ring-sun' : undefined}
                />
                <span className="w-full font-sans text-[1rem] leading-tight break-words">{h.title ?? 'an object'}</span>
              </button>
            ))}
          </div>
          {picked && (
            <>
              <Button onClick={() => record.mutate()} disabled={!me || record.isPending}>
                <Mic className="size-7" strokeWidth={2.2} aria-hidden />
                {record.isPending ? 'getting ready…' : 'record it'}
              </Button>
              <FormError>{record.error?.message}</FormError>
              <Disclosure summary="or write it down">
                <div className="flex flex-col gap-3">
                  <textarea
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value)
                      setSaved(false)
                    }}
                    rows={5}
                    placeholder="a memory in your own words — who, when, why it matters."
                    className={textareaClass}
                  />
                  <Button onClick={() => save.mutate()} disabled={!text.trim() || save.isPending}>
                    {save.isPending ? 'sharing…' : 'share story →'}
                  </Button>
                  <Button
                    tone="secondary"
                    onClick={() => {
                      writeDraft(heirloomId, { description: text })
                      setSaved(true)
                    }}
                    disabled={!text.trim()}
                  >
                    save draft
                  </Button>
                  {saved && <Notice tone="success">draft saved on this phone.</Notice>}
                  <FormError>{save.error?.message}</FormError>
                </div>
              </Disclosure>
              <Link to={`/h/${picked.id}`} className="py-2 text-center font-sans text-[1.3rem] underline-offset-4 hover:underline">
                open {picked.title ?? 'the object'}
              </Link>
            </>
          )}
        </>
      )}
    </ScreenBody>
  )
}
