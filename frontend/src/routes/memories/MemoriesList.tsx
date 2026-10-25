import { useInfiniteQuery } from '@tanstack/react-query'
import { Play, Plus } from 'lucide-react'
import { Link, useLocation } from 'react-router'
import { Button, Chip, Disclosure, EmptyState, ErrorState, FormError, Header, Loading, Notice, ScreenBody } from '@/components/ui/chrome'
import { api } from '@/lib/api'
import { formatApiError } from '@/lib/apiError'
import { useChooseFamily, useFamilies, useFamily, useFamilyTree } from '@/lib/family'
import { useScreenTitle } from '@/lib/useScreenTitle'
import type { MemorySummary } from './data'
import { PhotoThumb } from './parts'

const PAGE = 20

/** Screen 24: the family's published memories, plus my own drafts. */
export function MemoriesList() {
  useScreenTitle('family memories')
  const family = useFamily()
  const familyId = family.data?.id
  const tree = useFamilyTree(familyId)
  const notice = (useLocation().state as { notice?: string } | null)?.notice
  const memories = useInfiniteQuery({
    queryKey: ['memories', familyId],
    enabled: !!familyId,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await api.GET('/api/families/{family_id}/memories', {
        params: { path: { family_id: familyId! }, query: { limit: PAGE, offset: pageParam, include_my_drafts: true } },
      })
      if (error || !data) throw new Error(formatApiError(error, 'we could not load your family memories.'))
      return data
    },
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length * PAGE : undefined),
  })
  const families = useFamilies()
  const others = families.data?.filter((f) => f.id !== familyId) ?? []

  const header = <Header title="family memories" back="/" />
  if (family.isLoading) return <ScreenBody>{header}<Loading /></ScreenBody>
  if (family.isError)
    return (
      <ScreenBody>
        {header}
        <ErrorState message={family.error.message} onRetry={() => family.refetch()} />
      </ScreenBody>
    )
  if (!family.data)
    return (
      <ScreenBody>
        {header}
        <EmptyState title="start your family first" action={<Button to="/family">go to family</Button>}>
          memories are shared with your family, so you need one to add them.
        </EmptyState>
      </ScreenBody>
    )

  const all = memories.data?.pages.flat() ?? []
  const drafts = all.filter((m) => m.status === 'draft')
  const shared = all.filter((m) => m.status === 'published')
  const me = tree.data?.me

  return (
    <ScreenBody screen="family-memories">
      {header}
      {family.data && (
        <p className="-mt-3 mb-1 text-center font-sans text-[1.15rem] leading-snug break-words text-muted">
          {family.data.name}
        </p>
      )}
      {others.length > 0 && <FamilySwitcher others={others.map((f) => ({ id: f.id, name: f.name }))} />}
      <div className="flex flex-1 flex-col gap-5">
        {notice && <Notice tone="success">{notice}</Notice>}
        {memories.isLoading ? (
          <Loading label="finding your memories…" />
        ) : !memories.data ? (
          <ErrorState message={memories.error?.message} onRetry={() => memories.refetch()} />
        ) : (
          <>
            {shared.length === 0 ? (
              <EmptyState title="no memories yet">
                add a few photos from a day you remember, then tell the story in your own voice.
              </EmptyState>
            ) : (
              <div className="grid grid-cols-2 gap-x-3 gap-y-4">
                {shared.map((m) => (
                  <MemoryCard key={m.id} m={m} mine={m.contributor_id === me} />
                ))}
              </div>
            )}
            {drafts.length > 0 && (
              <section className="flex flex-col gap-3">
                <h2 className="font-hand text-[1.7rem] leading-none">your drafts</h2>
                <p className="-mt-1 font-sans text-[1.1rem] leading-snug text-muted">only you can see these.</p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-4">
                  {drafts.map((m) => (
                    <MemoryCard key={m.id} m={m} mine />
                  ))}
                </div>
              </section>
            )}
            {memories.hasNextPage && (
              <Button tone="secondary" onClick={() => memories.fetchNextPage()} disabled={memories.isFetchingNextPage}>
                {memories.isFetchingNextPage ? 'loading…' : 'show more'}
              </Button>
            )}
            {memories.isFetchNextPageError && (
              <ErrorState message="we could not load more memories." onRetry={() => memories.fetchNextPage()} />
            )}
          </>
        )}
        <div className="mt-auto pt-2">
          <Button to="/memories/new">
            <Plus className="size-7" strokeWidth={2.4} /> add memory
          </Button>
        </div>
      </div>
    </ScreenBody>
  )
}

/** Other families you belong to. Memories are per-family, so switch to see theirs. */
function FamilySwitcher({ others }: { others: { id: string; name: string }[] }) {
  const choose = useChooseFamily()
  return (
    <Disclosure summary={`switch family (${others.length + 1} families)`} className="mb-1">
      <ul className="flex flex-col gap-2">
        {others.map((f) => (
          <li key={f.id}>
            <Button tone="secondary" disabled={choose.isPending} onClick={() => choose.mutate(f.id)}>
              {f.name}
            </Button>
          </li>
        ))}
      </ul>
      <FormError>{choose.error?.message}</FormError>
    </Disclosure>
  )
}

function MemoryCard({ m, mine }: { m: MemorySummary; mine: boolean }) {
  const draft = m.status === 'draft'
  return (
    <Link to={draft ? `/memories/${m.id}/edit` : `/memories/${m.id}`} className="flex min-w-0 flex-col gap-1.5">
      <span className="relative">
        <PhotoThumb src={m.cover_url} className="aspect-square w-full" />
        {m.audio_url && (
          <span
            className="absolute bottom-2 left-2 grid size-9 place-items-center rounded-full border-2 border-ink bg-ink text-paper"
            aria-label="has a recording"
          >
            <Play className="ml-0.5 size-4" fill="currentColor" />
          </span>
        )}
        {draft && (
          <span className="absolute top-2 left-2">
            <Chip tone="sun">draft</Chip>
          </span>
        )}
      </span>
      {m.title && <span className="font-sans text-[1.2rem] leading-tight break-words">{m.title}</span>}
      <span className="font-sans text-[1.05rem] leading-tight break-words text-muted">
        by {mine ? 'you' : m.contributor_name}
      </span>
    </Link>
  )
}
