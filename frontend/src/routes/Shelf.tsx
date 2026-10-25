import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { BottomNav } from '@/components/ui/Nav'
import { ScreenHeader } from '@/components/ui/Screen'
import { api, type Schemas } from '@/lib/api'
import { useFamily } from '@/lib/family'

type Tab = 'yours' | 'family'

/** Your stories, or pick someone you're connected to and read theirs. */
export function Shelf() {
  const { data: family, isLoading } = useFamily()
  const [params, setParams] = useSearchParams()
  const person = params.get('person')
  const tab: Tab = person || params.get('tab') === 'family' ? 'family' : 'yours'
  const go = (next: Record<string, string>) => setParams(next, { replace: true })

  const people = useQuery({
    queryKey: ['connections'],
    enabled: tab === 'family',
    queryFn: async () => (await api.GET('/api/connections')).data ?? [],
  })
  const stories = useQuery({
    queryKey: ['archive', person ?? 'me'],
    enabled: tab === 'yours' || !!person,
    queryFn: async () =>
      (await api.GET('/api/archive', { params: { query: { user_id: person ?? undefined } } }))
        .data ?? [],
  })
  const heirlooms = useQuery({
    queryKey: ['heirlooms', family?.id],
    enabled: !!family && tab === 'yours',
    queryFn: async () =>
      (await api.GET('/api/heirlooms', { params: { query: { family_id: family!.id } } })).data ??
      [],
  })

  if (isLoading) return null
  if (!family) return <CreateFamily />

  const told = new Set((stories.data ?? []).map((s) => s.heirloom_id))
  const untold = (heirlooms.data ?? []).filter((h) => !told.has(h.id))
  const chosen = (people.data ?? []).find((p) => p.user_id === person)

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <ScreenHeader title="Stories" />
      <div className="mb-6 flex gap-2">
        {(['yours', 'family'] as const).map((t) => (
          <button
            key={t}
            onClick={() => go(t === 'family' ? { tab: 'family' } : {})}
            className={`flex-1 rounded-lg px-4 py-3 ${tab === t ? 'bg-ink text-paper' : 'border border-ink/20 bg-white'}`}
          >
            {t === 'yours' ? 'Your stories' : 'Family stories'}
          </button>
        ))}
      </div>

      {tab === 'family' && !person && (
        <People people={people.data} loading={people.isLoading} onPick={(id) => go({ person: id })} />
      )}

      {(tab === 'yours' || person) && (
        <>
          {person && (
            <header className="mb-4 flex items-baseline justify-between gap-2">
              <h1 className="font-serif text-3xl">{chosen ? `${chosen.display_name}'s stories` : 'Stories'}</h1>
              <button onClick={() => go({ tab: 'family' })} className="text-sm text-muted underline">
                Everyone
              </button>
            </header>
          )}
          <div className="flex flex-col gap-4">
            {stories.isLoading && <p className="text-muted">Loading stories…</p>}
            {stories.isError && <p className="text-muted">You can&apos;t open these stories.</p>}
            {stories.data?.length === 0 && (
              <p className="text-muted">
                {person
                  ? 'No stories here yet.'
                  : 'No stories yet. Photograph an object and ask someone to tell it.'}
              </p>
            )}
            {(stories.data ?? []).map((s) => (
              <StoryCard key={s.heirloom_id} story={s} />
            ))}
          </div>
        </>
      )}

      {tab === 'yours' && untold.length > 0 && (
        <>
          <h2 className="mt-8 font-serif text-xl">Not yet told</h2>
          <div className="mt-2 grid grid-cols-2 gap-4">
            {untold.map((h) => (
              <Link key={h.id} to={`/h/${h.id}`} className="overflow-hidden rounded-xl bg-white shadow">
                {h.cover_url && <img src={h.cover_url} className="aspect-square w-full object-cover" alt="" />}
                <p className="p-3 font-serif">{h.title ?? 'Untitled'}</p>
              </Link>
            ))}
          </div>
        </>
      )}
      <BottomNav />
    </main>
  )
}

function People({
  people,
  loading,
  onPick,
}: {
  people: Schemas['Connection'][] | undefined
  loading: boolean
  onPick: (userId: string) => void
}) {
  if (loading) return <p className="text-muted">Loading your people…</p>
  if (!people?.length) {
    return (
      <div className="rounded-xl bg-white p-6 text-center shadow">
        <p className="text-muted">Once someone accepts your request, their stories appear here.</p>
        <Link to="/family" className="mt-3 inline-block rounded-lg bg-ink px-4 py-2 text-paper">
          Add family or friends
        </Link>
      </div>
    )
  }
  return (
    <>
      {(['family', 'friend'] as const).map((k) => {
        const group = people.filter((p) => p.kind === k)
        if (group.length === 0) return null
        return (
          <section key={k} className="mb-6">
            <h2 className="mb-2 font-serif text-xl">{k === 'family' ? 'Family' : 'Friends'}</h2>
            <ul className="divide-y divide-ink/10 rounded-xl bg-white shadow">
              {group.map((p) => (
                <li key={p.user_id}>
                  <button
                    onClick={() => onPick(p.user_id)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left"
                  >
                    <span className="text-lg">{p.display_name}</span>
                    <span className="text-sm text-muted">
                      {p.story_count} {p.story_count === 1 ? 'story' : 'stories'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </>
  )
}

function StoryCard({ story: s }: { story: Schemas['ArchiveStory'] }) {
  return (
    <Link to={`/h/${s.heirloom_id}`} className="overflow-hidden rounded-xl bg-white shadow">
      {s.cover_url && <img src={s.cover_url} className="aspect-video w-full object-cover" alt="" />}
      <div className="p-4">
        <p className="font-serif text-xl">{s.title}</p>
        {s.storyteller_name && <p className="text-sm text-muted">Told by {s.storyteller_name}</p>}
        {s.object_title && s.object_title !== s.title && (
          <p className="text-sm text-muted">{s.object_title}</p>
        )}
      </div>
    </Link>
  )
}

function CreateFamily() {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [yourName, setYourName] = useState('')
  const create = useMutation({
    mutationFn: () => api.POST('/api/families', { body: { name, your_name: yourName } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['families'] }),
  })

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-3 px-4">
      <h1 className="font-serif text-3xl">Start your family's Lorebook</h1>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Family name"
        className="rounded-lg border border-ink/20 bg-white px-4 py-3"
      />
      <input
        value={yourName}
        onChange={(e) => setYourName(e.target.value)}
        placeholder="Your name"
        className="rounded-lg border border-ink/20 bg-white px-4 py-3"
      />
      <button
        disabled={!name || !yourName || create.isPending}
        onClick={() => create.mutate()}
        className="rounded-lg bg-ink px-4 py-3 text-paper disabled:opacity-40"
      >
        Create
      </button>
    </main>
  )
}
