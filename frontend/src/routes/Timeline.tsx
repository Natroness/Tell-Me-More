import { useState, type ReactNode } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { ChevronUp, Image as ImageIcon, Package, Repeat } from 'lucide-react'
import { Button, EmptyState, ErrorState, Header, Loading, ScreenBody, TextButton } from '@/components/ui/chrome'
import { api, type Schemas } from '@/lib/api'
import { formatApiError } from '@/lib/apiError'
import { useScreenTitle } from '@/lib/useScreenTitle'
import { FamilyGate } from '@/routes/dates/FamilyGate'
import { category, clockTime, iso, parseIso, shortDate, todayIso } from '@/routes/dates/shared'

type Item = Schemas['TimelinePage']['items'][number]

/** The API spans at most ~10 years per query, so history loads one decade at a time. */
const SPAN = 10
const OLDEST = 1800
const PAGE = 50

/** Screen 33: stories, memories, and important dates on one line through the years. */
export function Timeline() {
  useScreenTitle('timeline')
  return (
    <ScreenBody screen="timeline">
      <Header title="timeline" back="/" />
      <FamilyGate>{(familyId) => <Decades familyId={familyId} />}</FamilyGate>
    </ScreenBody>
  )
}

function Decades({ familyId }: { familyId: string }) {
  const thisYear = parseIso(todayIso()).year
  const [earlier, setEarlier] = useState(0)
  const covers = useQuery({
    queryKey: ['heirlooms', familyId],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/heirlooms', { params: { query: { family_id: familyId } } })
      if (error || !data) throw new Error(formatApiError(error))
      return data
    },
  })
  const coverOf = (heirloomId: string) => covers.data?.find((h) => h.id === heirloomId)?.cover_url ?? null
  const windows = Array.from({ length: earlier + 1 }, (_, i) => thisYear - SPAN * (earlier - i))
  const oldestStart = windows[0] - SPAN + 1

  return (
    <div className="flex flex-col gap-4">
      {oldestStart > OLDEST && (
        <TextButton onClick={() => setEarlier((n) => n + 1)}>
          <span className="inline-flex items-center gap-1.5">
            <ChevronUp className="size-5" strokeWidth={2.4} aria-hidden /> show {oldestStart - SPAN}–{oldestStart - 1}
          </span>
        </TextButton>
      )}
      {windows.map((endYear) => (
        <Decade
          key={endYear}
          familyId={familyId}
          endYear={endYear}
          current={endYear === thisYear}
          coverOf={coverOf}
          empty={
            endYear === thisYear && earlier === 0 ? (
              <EmptyState
                title="nothing on the timeline yet"
                action={<Button to="/dates/new">add an important date</Button>}
              >
                stories, family memories, and important dates appear here in order. older stories may be further
                back.
              </EmptyState>
            ) : (
              <p className="py-2 text-center font-sans text-[1.1rem] text-muted">
                nothing from {endYear - SPAN + 1}–{endYear}
              </p>
            )
          }
        />
      ))}
    </div>
  )
}

function Decade({
  familyId,
  endYear,
  current,
  coverOf,
  empty,
}: {
  familyId: string
  endYear: number
  current: boolean
  coverOf: (heirloomId: string) => string | null
  empty: ReactNode
}) {
  const start = iso(endYear - SPAN + 1, 0, 1)
  const end = iso(endYear, 11, 31)
  const query = useInfiniteQuery({
    queryKey: ['timeline', familyId, start, end, current],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await api.GET('/api/families/{family_id}/timeline', {
        params: {
          path: { family_id: familyId },
          query: { start, end, limit: PAGE, offset: pageParam, include_unknown: current },
        },
      })
      if (error || !data) throw new Error(formatApiError(error, 'we could not load the timeline.'))
      return data
    },
    getNextPageParam: (last) => last.next_offset ?? undefined,
  })

  if (query.isPending) return <Loading label="gathering the years…" />
  if (query.isError && !query.data) {
    return <ErrorState message={query.error.message} onRetry={() => query.refetch()} />
  }

  const seen = new Set<string>()
  const items = query.data.pages.flatMap((p) => p.items).filter((i) => !seen.has(i.item_key) && seen.add(i.item_key))
  if (items.length === 0 && !query.hasNextPage) return <>{empty}</>

  return (
    <div className="flex flex-col gap-3">
      <ol className="relative flex flex-col gap-3">
        <span className="absolute top-2 bottom-2 left-[4.6rem] w-0.5 -translate-x-1/2 bg-ink" aria-hidden />
        {items.map((item, i) => {
          const year = yearLabel(item)
          const firstOfYear = i === 0 || yearLabel(items[i - 1]) !== year
          return (
            <li key={item.item_key} className="relative grid grid-cols-[3.6rem_2rem_1fr] items-start">
              <span className="pt-3 pr-1 text-right font-hand text-[1.3rem] leading-none">
                {firstOfYear ? year : ''}
              </span>
              <span className="flex justify-center pt-3.5" aria-hidden>
                <span className="size-4 rounded-full border-2 border-ink bg-sun" />
              </span>
              <ItemCard item={item} coverOf={coverOf} />
            </li>
          )
        })}
      </ol>
      {query.isError ? (
        <ErrorState message={query.error.message} onRetry={() => query.fetchNextPage()} />
      ) : (
        query.hasNextPage && (
          <Button tone="secondary" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {query.isFetchingNextPage ? 'loading…' : 'load more'}
          </Button>
        )
      )}
    </div>
  )
}

function yearLabel(item: Item) {
  return item.relevant_year == null ? '?' : String(item.relevant_year)
}

function ItemCard({ item, coverOf }: { item: Item; coverOf: (heirloomId: string) => string | null }) {
  let to: string
  let thumb: ReactNode
  let meta: ReactNode[] = []
  if (item.source_type === 'story') {
    to = `/h/${item.heirloom_id}`
    const cover = coverOf(item.heirloom_id)
    thumb = cover ? (
      <img src={cover} alt="" className="size-full object-cover" />
    ) : (
      <Package className="size-6" strokeWidth={2.2} />
    )
    if (item.title !== item.story_title) meta.push(`from ${item.story_title}`)
    if (item.date_precision === 'unknown') meta.push('year not known yet')
  } else if (item.source_type === 'memory') {
    to = `/memories/${item.source_id}`
    thumb = <ImageIcon className="size-6" strokeWidth={2.2} />
    meta = [shortDate(item.event_date, true), `shared by ${item.contributor_name}`]
  } else {
    to = `/events/${item.source_id}`
    const kind = category(item.category)
    const Icon = kind.icon
    thumb = <Icon className="size-6" strokeWidth={2.2} />
    if (item.relevant_date) meta.push(shortDate(item.relevant_date))
    if (item.time) meta.push(clockTime(item.time, item.time_zone))
    meta.push(kind.label)
    if (item.repeats_annually) {
      meta.push(
        <span key="repeat" className="inline-flex items-center gap-1">
          <Repeat className="size-3.5" aria-hidden /> every year
        </span>,
      )
    }
  }
  return (
    <Link
      to={to}
      className="hand-box flex min-w-0 items-center gap-3 border-2 border-ink p-2.5 transition-colors hover:bg-ink/5"
    >
      <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl border-2 border-ink" aria-hidden>
        {thumb}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-sans text-[1.2rem] leading-tight break-words">{item.title}</span>
        {meta.length > 0 && (
          <span className="mt-0.5 flex flex-wrap gap-x-2 font-sans text-[1rem] leading-snug text-muted">
            {meta.map((m, i) => (
              <span key={i} className="break-words">
                {i > 0 && '· '}
                {m}
              </span>
            ))}
          </span>
        )}
      </span>
    </Link>
  )
}
