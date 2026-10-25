import { Link, useSearchParams } from 'react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { ErrorState, Header, ScreenBody } from '@/components/ui/chrome'
import { useScreenTitle } from '@/lib/useScreenTitle'
import { cn } from '@/lib/utils'
import { FamilyGate } from './FamilyGate'
import { MONTHS, countByDay, daysInMonth, iso, leadingBlanks, parseIso, todayIso, useOccurrences } from './shared'

/** Screen 18: twelve small months, dots where the family has dates. */
export function YearOverview() {
  useScreenTitle('year overview')
  const [params, setParams] = useSearchParams()
  const raw = Number(params.get('year'))
  const year = Number.isInteger(raw) && raw >= 1 && raw <= 9999 ? raw : parseIso(todayIso()).year
  return (
    <ScreenBody screen="dates-year">
      <Header title="year overview" back={`/dates?month=${year}-01`} />
      <div className="mb-4 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setParams({ year: String(year - 1) }, { replace: true })}
          aria-label="previous year"
          className="grid size-12 place-items-center"
        >
          <ChevronLeft className="size-7" strokeWidth={2.2} />
        </button>
        <p className="font-hand text-[2rem] leading-none">{year}</p>
        <button
          type="button"
          onClick={() => setParams({ year: String(year + 1) }, { replace: true })}
          aria-label="next year"
          className="grid size-12 place-items-center"
        >
          <ChevronRight className="size-7" strokeWidth={2.2} />
        </button>
      </div>
      <FamilyGate>{(familyId) => <Months familyId={familyId} year={year} />}</FamilyGate>
    </ScreenBody>
  )
}

function Months({ familyId, year }: { familyId: string; year: number }) {
  const occurrences = useOccurrences(familyId, iso(year, 0, 1), iso(year, 11, 31))
  const counts = countByDay(occurrences.data)
  const today = todayIso()
  return (
    <div className="flex flex-col gap-4">
      {occurrences.isError && <ErrorState message={occurrences.error.message} onRetry={() => occurrences.refetch()} />}
      <div className="grid grid-cols-3 gap-2.5">
        {MONTHS.map((name, month) => {
          const days = daysInMonth(year, month)
          let total = 0
          for (let d = 1; d <= days; d++) total += counts.get(iso(year, month, d)) ?? 0
          return (
            <Link
              key={name}
              to={`/dates?month=${iso(year, month, 1).slice(0, 7)}`}
              aria-label={`${name} ${year}${total ? `, ${total} ${total === 1 ? 'date' : 'dates'}` : ''}`}
              className="hand-box flex flex-col gap-1.5 border-2 border-ink p-2 transition-colors hover:bg-ink/5"
            >
              <span className="text-center font-hand text-[1.3rem] leading-none">{name.slice(0, 3)}</span>
              <span className="grid grid-cols-7 gap-[3px]" aria-hidden>
                {Array.from({ length: leadingBlanks(year, month) }, (_, i) => (
                  <span key={`b${i}`} />
                ))}
                {Array.from({ length: days }, (_, i) => {
                  const date = iso(year, month, i + 1)
                  return (
                    <span
                      key={date}
                      className={cn(
                        'aspect-square rounded-full',
                        counts.has(date) ? 'border border-ink bg-sun' : 'bg-ink/15',
                        date === today && 'ring-[1.5px] ring-ink',
                      )}
                    />
                  )
                })}
              </span>
              <span className="text-center font-sans text-[1rem] leading-none text-muted">
                {occurrences.isPending ? '…' : total ? `${total} ${total === 1 ? 'date' : 'dates'}` : ' '}
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
