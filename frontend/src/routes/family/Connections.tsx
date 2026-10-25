import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Search } from 'lucide-react'
import { Link } from 'react-router'
import { Avatar, Card, Chip, Disclosure, ErrorState, FormError, Loading, Notice } from '@/components/ui/chrome'
import { api, type Schemas } from '@/lib/api'
import { formatApiError } from '@/lib/apiError'
import { Segmented } from '@/routes/account/controls'

type Kind = Schemas['Connection']['kind']

const KINDS: { id: Kind; label: string }[] = [
  { id: 'family', label: 'family' },
  { id: 'friend', label: 'friend' },
]

const pill =
  'hand-pill inline-flex min-h-12 items-center justify-center border-2 border-ink px-4 font-sans text-[1.2rem] leading-none disabled:opacity-50'

function stories(n: number) {
  return n === 0 ? 'no stories yet' : `${n} ${n === 1 ? 'story' : 'stories'}`
}

/** Family and friends who have their own accounts: requests, answers, and who you are connected to. */
export function Connections({ anchorPersonId }: { anchorPersonId?: string | null }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const connections = useQuery({
    queryKey: ['connections'],
    queryFn: async () => {
      const { data, error: apiError } = await api.GET('/api/connections')
      if (apiError || !data) throw new Error(formatApiError(apiError, 'we could not load your connections.'))
      return data
    },
  })
  const requests = useQuery({
    queryKey: ['connections', 'requests'],
    queryFn: async () => {
      const { data, error: apiError } = await api.GET('/api/connections/requests')
      if (apiError || !data) throw new Error(formatApiError(apiError, 'we could not load requests.'))
      return data
    },
    refetchInterval: 30_000,
  })

  async function answer(r: Schemas['ConnectionRequest'], action: 'accept' | 'decline') {
    setBusy(r.id)
    setError(null)
    const { error: apiError } =
      action === 'accept'
        ? await api.POST('/api/connections/requests/{request_id}/accept', {
            params: { path: { request_id: r.id } },
            body: { kind: r.kind },
          })
        : await api.POST('/api/connections/requests/{request_id}/decline', {
            params: { path: { request_id: r.id } },
          })
    setBusy(null)
    if (apiError) setError(formatApiError(apiError, 'that did not work. try again.'))
    qc.invalidateQueries({ queryKey: ['connections'] })
  }

  const incoming = requests.data?.incoming ?? []
  const outgoing = requests.data?.outgoing ?? []

  return (
    <section className="mt-10 flex flex-col gap-4" aria-labelledby="connections-heading">
      <h2 id="connections-heading" className="font-hand text-[1.9rem] leading-none">
        family & friends
      </h2>

      {requests.isError && <ErrorState message={requests.error.message} onRetry={() => requests.refetch()} />}
      {incoming.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="font-sans text-[1.3rem] leading-none">requests to connect</h3>
          {incoming.map((r) => (
            <Card key={r.id}>
              <div className="flex items-center gap-3">
                <Avatar name={r.display_name} />
                <p className="min-w-0 flex-1 font-sans text-[1.2rem] leading-snug break-words">
                  {r.display_name} wants to connect as {r.kind}
                </p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" className={`${pill} bg-sun text-black`} disabled={busy !== null} onClick={() => answer(r, 'accept')}>
                  {busy === r.id ? 'one moment…' : 'accept'}
                </button>
                <button type="button" className={`${pill} bg-paper text-ink`} disabled={busy !== null} onClick={() => answer(r, 'decline')}>
                  decline
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <FormError>{error}</FormError>

      {connections.isLoading && <Loading label="loading connections…" />}
      {connections.isError && (
        <ErrorState message={connections.error.message} onRetry={() => connections.refetch()} />
      )}
      {connections.data && connections.data.length === 0 && incoming.length === 0 && (
        <p className="font-sans text-[1.15rem] leading-snug text-muted">
          connect with relatives and friends who have their own account to share stories.
        </p>
      )}
      {connections.data && connections.data.length > 0 && (
        <ul className="flex flex-col gap-2">
          {connections.data.map((c) => (
            <li key={c.user_id} className="flex items-center gap-3">
              <Avatar name={c.display_name} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block font-sans text-[1.25rem] leading-tight break-words">{c.display_name}</span>
                <span className="block font-sans text-[1rem] text-muted">{stories(c.story_count)}</span>
              </span>
              <Chip>{c.kind}</Chip>
              {anchorPersonId && <Link
                to={`/family/invite/${anchorPersonId}?connection=${encodeURIComponent(c.user_id)}`}
                className={`${pill} shrink-0`} aria-label={`add ${c.display_name} to the tree`}>add to tree</Link>}
            </li>
          ))}
        </ul>
      )}
      {outgoing.length > 0 && (
        <p className="font-sans text-[1.05rem] leading-snug text-muted">
          waiting for {outgoing.map((r) => r.display_name).join(', ')} to answer.
        </p>
      )}

      <Disclosure summary="find someone on tell me more">
        <FindPeople />
      </Disclosure>
    </section>
  )
}

function FindPeople() {
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<Kind>('family')
  const [sent, setSent] = useState<{ name: string; accepted: boolean } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const query = q.trim()
  const results = useQuery({
    queryKey: ['users', 'search', query],
    enabled: query.length >= 2,
    queryFn: async () => {
      const { data, error: apiError } = await api.GET('/api/users/search', { params: { query: { q: query } } })
      if (apiError || !data) throw new Error(formatApiError(apiError, 'search did not work.'))
      return data
    },
  })

  async function ask(person: Schemas['Account']) {
    setBusy(person.user_id)
    setError(null)
    setSent(null)
    const { data, error: apiError } = await api.POST('/api/connections/requests', {
      body: { user_id: person.user_id, kind },
    })
    setBusy(null)
    if (apiError || !data) {
      setError(formatApiError(apiError, 'we could not send that request. try again.'))
      return
    }
    setSent({ name: person.display_name, accepted: data.status === 'accepted' })
    qc.invalidateQueries({ queryKey: ['connections'] })
    qc.invalidateQueries({ queryKey: ['users', 'search'] })
  }

  return (
    <div className="flex flex-col gap-3 pt-1">
      <label className="hand-box flex h-14 items-center gap-3 border-[1.5px] border-ink/40 px-4 focus-within:border-ink">
        <Search className="size-5 shrink-0" strokeWidth={2.2} aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="their name"
          aria-label="search by name"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent font-sans text-[1.25rem] text-ink outline-none placeholder:text-muted"
        />
      </label>
      <Segmented label="connect as" options={KINDS} value={kind} onChange={setKind} />
      {sent && (
        <Notice tone="success">
          {sent.accepted ? `you and ${sent.name} are connected.` : `request sent to ${sent.name}.`}
        </Notice>
      )}
      <FormError>{error}</FormError>
      {results.isFetching && <p className="font-sans text-[1.05rem] text-muted">searching…</p>}
      {results.isError && <ErrorState message={results.error.message} onRetry={() => results.refetch()} />}
      {results.data && results.data.length === 0 && !results.isFetching && (
        <p className="font-sans text-[1.05rem] text-muted">no one by that name yet.</p>
      )}
      {results.data && results.data.length > 0 && (
        <ul className="flex flex-col gap-2">
          {results.data.map((p) => (
            <li key={p.user_id} className="flex items-center gap-3">
              <Avatar name={p.display_name} size="sm" />
              <span className="min-w-0 flex-1 font-sans text-[1.2rem] leading-tight break-words">{p.display_name}</span>
              <button type="button" className={`${pill} bg-sun text-black`} disabled={busy !== null} onClick={() => ask(p)}>
                {busy === p.user_id ? 'sending…' : 'ask'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
