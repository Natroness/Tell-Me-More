import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Link } from 'react-router'
import { BigButton, ScreenHeader } from '@/components/ui/Screen'
import { api } from '@/lib/api'

/** Brief §3E: search-first storyteller picker (0–5 ranked results) + cards + Send. */
export function ChooseStoryteller() {
  const { heirloomId } = useParams() as { heirloomId: string }
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [selected, setSelected] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 250)
    return () => window.clearTimeout(t)
  }, [search])

  const detail = useQuery({
    queryKey: ['heirloom', heirloomId],
    queryFn: async () =>
      (await api.GET('/api/heirlooms/{heirloom_id}', {
        params: { path: { heirloom_id: heirloomId } },
      })).data,
  })
  const familyId = detail.data?.heirloom.family_id
  const people = useQuery({
    queryKey: ['people', familyId],
    enabled: !!familyId && !debounced,
    queryFn: async () =>
      (await api.GET('/api/families/{family_id}/people', {
        params: { path: { family_id: familyId! } },
      })).data ?? [],
  })
  const results = useQuery({
    queryKey: ['people-search', familyId, debounced],
    enabled: !!familyId && debounced.length > 0,
    queryFn: async () =>
      (await api.GET('/api/families/{family_id}/people/search', {
        params: { path: { family_id: familyId! }, query: { q: debounced, limit: 5 } },
      })).data ?? [],
  })

  const send = useMutation({
    mutationFn: async () =>
      (await api.POST('/api/requests', {
        body: {
          heirloom_id: heirloomId,
          storyteller_id: selected,
          message: message || undefined,
          idempotency_key: crypto.randomUUID(),
        },
      })).data!,
    onSuccess: (r) => navigate(`/request-confirm/${r.id}`),
  })

  const searching = debounced.length > 0
  const list = (searching ? (results.data ?? []) : (people.data ?? [])).filter((p) => p.relation !== 'you')
  const loading = searching ? results.isLoading : people.isLoading

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
      <ScreenHeader title="Choose storyteller" />
      <h1 className="font-serif text-3xl">Who might know its story?</h1>
      {detail.data?.heirloom.cover_url && (
        <img src={detail.data.heirloom.cover_url} className="rounded-xl" alt="Object" />
      )}
      <input
        value={search}
        onChange={(e) => {
          setSearch(e.target.value)
          setSelected('')
        }}
        placeholder="Search by name — e.g. John"
        aria-label="Search family by name"
        className="rounded-lg border border-ink/20 bg-white px-4 py-3"
      />
      {searching ? (
        <p className="text-sm text-muted">
          {loading
            ? 'Searching…'
            : results.data?.length
              ? `Top ${results.data.length} match${results.data.length > 1 ? 'es' : ''} — pick by full name.`
              : 'No matches. Try another spelling, or invite them below.'}
        </p>
      ) : (
        <p className="text-sm text-muted">Type a name to narrow it down, or pick below.</p>
      )}
      {list.length === 0 && !loading ? (
        <>
          <p className="text-muted">
            {searching
              ? 'Nobody matches that name yet. Your capture is saved — invite them first.'
              : 'No family members connected yet. Your capture is saved — invite someone first.'}
          </p>
          <BigButton to="/family" primary>
            Add family or friends
          </BigButton>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            {list.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelected(p.id)}
                className={`flex flex-col items-center gap-1 rounded-xl border p-4 ${
                  selected === p.id ? 'border-ink bg-white' : 'border-ink/20 bg-white/60'
                }`}
              >
                <span className="flex size-14 items-center justify-center rounded-full bg-ink/10 font-serif text-2xl">
                  {p.display_name.charAt(0)}
                </span>
                <span className="text-lg">{p.display_name}</span>
                {p.full_name && p.full_name !== p.display_name && (
                  <span className="text-sm text-muted">{p.full_name}</span>
                )}
                {p.relation && (
                  <span className="text-sm text-muted">{p.relation === 'family' ? 'Family' : 'Friend'}</span>
                )}
              </button>
            ))}
          </div>
          {selected && (
            <>
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Grandpa, who gave you this watch?"
                className="rounded-lg border border-ink/20 bg-white px-4 py-3"
              />
              <BigButton onClick={() => send.mutate()} disabled={send.isPending} primary>
                {send.isPending ? 'Sending…' : 'Send request'}
              </BigButton>
            </>
          )}
          {send.isError && <p className="text-red-700">Couldn&apos;t send. Try again.</p>}
        </>
      )}
      <Link to="/family" className="text-sm text-muted underline">
        Manage family
      </Link>
    </main>
  )
}
