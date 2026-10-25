import { Link, useSearchParams } from 'react-router'
import { ChevronLeft, ChevronRight, LayoutGrid, Plus, Repeat } from 'lucide-react'
import { Button, EmptyState, ErrorState, Header, Loading, ScreenBody } from '@/components/ui/chrome'
import { useScreenTitle } from '@/lib/useScreenTitle'
import { cn } from '@/lib/utils'
import { FamilyGate } from './FamilyGate'
import {
  MONTHS,
  WEEKDAYS,
  category,
  clockTime,
  countByDay,
  daysInMonth,
  iso,
  leadingBlanks,
  longDate,
  parseIso,
  shortDate,
  todayIso,
  useOccurrences,
  type Occurrence,
} from './shared'

function readMonth(value: string | null) {
  const match = value?.match(/^(\d{4})-(\d{2})$/)
  if (match) {
    const month = Number(match[2]) - 1
    if (month >= 0 && month < 12) return { year: Number(match[1]), month }
  }
  const today = parseIso(todayIso())
  return { year: today.year, month: today.month }
}

const monthParam = (year: number, month: number) => iso(year, month, 1).slice(0, 7)

/** Screen 17: month calendar with the family's important dates. */
export function DatesCalendar() {
  useScreenTitle('important dates')
  const [params] = useSearchParams()
  const { year } = readMonth(params.get('month'))
  return (
    <ScreenBody screen="dates">
      <Header
        title="important dates"
        back="/"
        right={
          <Link to={`/dates/year?year=${year}`} aria-label="year overview" className="grid size-12 place-items-center">
            <LayoutGrid className="size-7" strokeWidth={2.2} />
          </Link>
        }
      />
      <FamilyGate>{(familyId) => <Calendar familyId={familyId} />}</FamilyGate>
    </ScreenBody>
  )
}

function Calendar({ familyId }: { familyId: string }) {
  const [params, setParams] = useSearchParams()
  const { year, month } = readMonth(params.get('month'))
  const selected = params.get('day')?.startsWith(monthParam(year, month)) ? params.get('day') : null
  const today = todayIso()
  const days = daysInMonth(year, month)
  const occurrences = useOccurrences(familyId, iso(year, month, 1), iso(year, month, days))
  const counts = countByDay(occurrences.data)

  function go(delta: number) {
    const d = new Date(year, month + delta, 1)
    setParams({ month: monthParam(d.getFullYear(), d.getMonth()) }, { replace: true })
  }
  function pick(day: string) {
    const next: Record<string, string> = { month: monthParam(year, month) }
    if (day !== selected) next.day = day
    setParams(next, { replace: true })
  }

  const shown = (occurrences.data ?? []).filter((o) => !selected || o.occurrence_date === selected)
  const addTo = `/dates/new?date=${selected ?? (today.startsWith(monthParam(year, month)) ? today : iso(year, month, 1))}`

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => go(-1)} aria-label="previous month" className="grid size-12 place-items-center">
          <ChevronLeft className="size-7" strokeWidth={2.2} />
        </button>
        <Link
          to={`/dates/year?year=${year}`}
          className="font-hand text-[1.9rem] leading-none underline-offset-4 hover:underline"
          aria-label={`${MONTHS[month]} ${year}, open year overview`}
        >
          {MONTHS[month]} {year}
        </Link>
        <button type="button" onClick={() => go(1)} aria-label="next month" className="grid size-12 place-items-center">
          <ChevronRight className="size-7" strokeWidth={2.2} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-y-1 text-center">
        {WEEKDAYS.map((w) => (
          <span key={w} className="pb-1 font-sans text-[1rem] text-muted" aria-hidden>
            {w}
          </span>
        ))}
        {Array.from({ length: leadingBlanks(year, month) }, (_, i) => (
          <span key={`blank-${i}`} aria-hidden />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const date = iso(year, month, i + 1)
          const count = counts.get(date) ?? 0
          const isSelected = date === selected
          return (
            <button
              key={date}
              type="button"
              onClick={() => pick(date)}
              aria-pressed={isSelected}
              aria-label={`${longDate(date)}${count ? `, ${count} ${count === 1 ? 'date' : 'dates'}` : ''}${date === today ? ', today' : ''}`}
              className="flex min-h-12 flex-col items-center justify-start pt-0.5"
            >
              <span
                className={cn(
                  'grid size-9 place-items-center rounded-full border-2 font-sans text-[1.2rem] leading-none',
                  isSelected ? 'border-ink bg-sun text-black' : date === today ? 'border-ink' : 'border-transparent',
                )}
              >
                {i + 1}
              </span>
              <span
                className={cn('mt-0.5 size-2 rounded-full', count ? 'border border-ink bg-sun' : 'bg-transparent')}
                aria-hidden
              />
            </button>
          )
        })}
      </div>

      <section className="flex flex-col gap-3" aria-live="polite">
        <h2 className="font-hand text-[1.6rem] leading-tight break-words">
          {selected ? longDate(selected, false) : `in ${MONTHS[month]}`}
        </h2>
        {occurrences.isPending ? (
          <Loading label="finding dates…" />
        ) : occurrences.isError ? (
          <ErrorState message={occurrences.error.message} onRetry={() => occurrences.refetch()} />
        ) : shown.length === 0 ? (
          <EmptyState title={selected ? 'nothing on this day yet' : `nothing in ${MONTHS[month]} yet`}>
            birthdays, anniversaries, and gatherings you add show up here.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {shown.map((o) => (
              <li key={`${o.id}:${o.occurrence_date}`}>
                <OccurrenceCard occurrence={o} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <Button to={addTo}>
        <Plus className="size-7" strokeWidth={2.4} aria-hidden /> add event
      </Button>
    </div>
  )
}

function OccurrenceCard({ occurrence: o }: { occurrence: Occurrence }) {
  const kind = category(o.category)
  const Icon = kind.icon
  return (
    <Link
      to={`/events/${o.id}`}
      className="hand-box flex items-center gap-3 border-2 border-ink p-3 transition-colors hover:bg-ink/5"
    >
      <span className="grid size-14 shrink-0 place-items-center rounded-full border-2 border-ink bg-sun text-black" aria-hidden>
        <Icon className="size-7" strokeWidth={2.2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-sans text-[1.35rem] leading-tight break-words">{o.title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 font-sans text-[1.05rem] leading-snug text-muted">
          <span>{shortDate(o.occurrence_date)}</span>
          {o.time && <span>· {clockTime(o.time, o.time_zone)}</span>}
          <span>· {kind.label}</span>
          {o.repeats_annually && (
            <span className="inline-flex items-center gap-1">
              · <Repeat className="size-3.5" aria-hidden /> every year
            </span>
          )}
        </span>
      </span>
    </Link>
  )
}
