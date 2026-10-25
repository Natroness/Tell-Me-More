import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { BottomNav } from '@/components/ui/Nav'
import { ScreenHeader } from '@/components/ui/Screen'
import { api, type Schemas } from '@/lib/api'
import { firstName, useMe } from '@/lib/me'

type Kind = 'family' | 'friend'
const KINDS: Kind[] = ['family', 'friend']
const label = (k: Kind) => (k === 'family' ? 'Family' : 'Friend')

/** Your people: real accounts you asked and who said yes, each labelled the way you chose. */
export function Family() {
  const qc = useQueryClient()
  const me = useMe()
  const [raw, setRaw] = useState('')
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<Kind>('family')

  useEffect(() => {
    const t = window.setTimeout(() => setQ(raw.trim()), 250)
    return () => window.clearTimeout(t)
  }, [raw])

  const people = useQuery({
    queryKey: ['connections'],
    queryFn: async () => (await api.GET('/api/connections')).data ?? [],
  })
  const pending = useQuery({
    queryKey: ['connection-requests'],
    queryFn: async () => (await api.GET('/api/connections/requests')).data,
    refetchInterval: 10_000,
  })
  const found = useQuery({
    queryKey: ['user-search', q],
    enabled: q.length >= 2,
    queryFn: async () => (await api.GET('/api/users/search', { params: { query: { q } } })).data ?? [],
  })

  const refresh = () =>
    ['connections', 'connection-requests', 'user-search'].forEach((k) =>
      qc.invalidateQueries({ queryKey: [k] }),
    )
  const ask = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await api.POST('/api/connections/requests', {
        body: { user_id: userId, kind },
      })
      if (error) throw new Error('could not ask')
    },
    onSuccess: () => {
      setRaw('')
      refresh()
    },
  })
  const answer = useMutation({
    mutationFn: async (a: { id: string; kind: Kind | null }) => {
      const path = { params: { path: { request_id: a.id } } }
      const { error } = a.kind
        ? await api.POST('/api/connections/requests/{request_id}/accept', { ...path, body: { kind: a.kind } })
        : await api.POST('/api/connections/requests/{request_id}/decline', path)
      if (error) throw new Error('could not answer')
    },
    onSuccess: refresh,
  })
  const relabel = useMutation({
    mutationFn: async (a: { userId: string; kind: Kind }) =>
      api.PATCH('/api/connections/{other_id}', {
        params: { path: { other_id: a.userId } },
        body: { kind: a.kind },
      }),
    onSuccess: refresh,
  })

  const all = people.data ?? []
  const incoming = pending.data?.incoming ?? []
  const outgoing = pending.data?.outgoing ?? []

  function group(k: Kind, empty: string) {
    const rows = all.filter((p) => p.kind === k)
    return (
      <section>
        <h2 className="font-serif text-xl">
          {k === 'family' ? 'Family' : 'Friends'} ({rows.length})
        </h2>
        {rows.length === 0 ? (
          <p className="py-2 text-sm text-muted">{empty}</p>
        ) : (
          <ul className="divide-y divide-ink/10">{rows.map(row)}</ul>
        )}
      </section>
    )
  }

  function row(p: Schemas['Connection']) {
    return (
      <li key={p.user_id} className="flex items-center justify-between gap-2 py-2">
        <Link to={`/stories?person=${p.user_id}`} className="min-w-0">
          <span className="block truncate">{p.display_name}</span>
          <span className="text-sm text-muted">
            {p.story_count} {p.story_count === 1 ? 'story' : 'stories'}
          </span>
        </Link>
        <select
          value={p.kind}
          onChange={(e) => relabel.mutate({ userId: p.user_id, kind: e.target.value as Kind })}
          aria-label={`Group for ${p.display_name}`}
          className="rounded-lg border border-ink/20 bg-white px-2 py-1 text-sm"
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {label(k)}
            </option>
          ))}
        </select>
      </li>
    )
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-8">
      <ScreenHeader title="Family" />
      <h1 className="font-serif text-3xl">Your people, {firstName(me.data) || '…'}</h1>

      {incoming.length > 0 && (
        <section className="rounded-xl bg-white p-4 shadow">
          <h2 className="font-serif text-xl">Asking to join you</h2>
          <ul className="divide-y divide-ink/10">
            {incoming.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 py-3">
                <p>
                  <span className="font-semibold">{r.display_name}</span> added you as{' '}
                  {r.kind === 'family' ? 'family' : 'a friend'}.
                </p>
                <div className="flex gap-2">
                  {KINDS.map((k) => (
                    <button
                      key={k}
                      disabled={answer.isPending}
                      onClick={() => answer.mutate({ id: r.id, kind: k })}
                      className="flex-1 rounded-lg bg-ink px-3 py-2 text-sm text-paper disabled:opacity-40"
                    >
                      Accept as {label(k).toLowerCase()}
                    </button>
                  ))}
                  <button
                    disabled={answer.isPending}
                    onClick={() => answer.mutate({ id: r.id, kind: null })}
                    className="rounded-lg border border-ink/20 px-3 py-2 text-sm disabled:opacity-40"
                  >
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {people.isLoading ? (
        <p className="text-muted">Loading your people…</p>
      ) : (
        <>
          {group('family', 'Nobody yet. Search below to ask a relative.')}
          {group('friend', 'Friends you add show up here.')}
        </>
      )}

      {outgoing.length > 0 && (
        <section>
          <h2 className="font-serif text-xl">Waiting for an answer</h2>
          <ul className="text-muted">
            {outgoing.map((r) => (
              <li key={r.id} className="py-1">
                {r.display_name} · as {label(r.kind).toLowerCase()}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="font-serif text-xl">Add someone</h2>
        <p className="mt-1 text-sm text-muted">
          They need to have signed in once. They&apos;ll see your request and choose to accept.
        </p>
        <div className="mt-3 flex gap-2">
          {KINDS.map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`flex-1 rounded-lg px-4 py-2 ${kind === k ? 'bg-ink text-paper' : 'border border-ink/20 bg-white'}`}
            >
              {label(k)}
            </button>
          ))}
        </div>
        <input
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="Search by name"
          aria-label="Search people by name"
          className="mt-3 w-full rounded-lg border border-ink/20 bg-white px-3 py-2"
        />
        {q.length >= 2 && (
          <ul className="mt-2 divide-y divide-ink/10 rounded-xl bg-white shadow">
            {found.isLoading && <li className="px-4 py-3 text-muted">Searching…</li>}
            {!found.isLoading && (found.data ?? []).length === 0 && (
              <li className="px-4 py-3 text-muted">Nobody new by that name.</li>
            )}
            {(found.data ?? []).map((u) => (
              <li key={u.user_id} className="flex items-center justify-between gap-3 px-4 py-2">
                <span>{u.display_name}</span>
                <button
                  disabled={ask.isPending}
                  onClick={() => ask.mutate(u.user_id)}
                  className="rounded-lg bg-ink px-4 py-2 text-sm text-paper disabled:opacity-40"
                >
                  Ask as {label(kind).toLowerCase()}
                </button>
              </li>
            ))}
          </ul>
        )}
        {ask.isError && <p className="mt-2 text-sm text-red-700">Couldn&apos;t send that. Try again.</p>}
      </section>
      <BottomNav />
    </main>
  )
}
