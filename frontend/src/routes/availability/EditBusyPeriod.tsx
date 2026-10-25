import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, EmptyState, ErrorState, FormError, Header, Loading, ScreenBody } from '@/components/ui/chrome'
import { api, type Schemas } from '@/lib/api'
import { useScreenTitle } from '@/lib/useScreenTitle'
import { cn } from '@/lib/utils'
import { Field, TimeZoneSelect } from './ui'
import {
  WEEKDAYS,
  controlClass,
  friendlyError,
  keys,
  parseDate,
  preferredZone,
  toIsoDate,
  useAvailabilitySettings,
} from './data'

type Period = Schemas['BusyPeriod']

export function EditBusyPeriodScreen() {
  const { entryId } = useParams()
  const isNew = !entryId
  useScreenTitle(isNew ? 'add busy period' : 'edit busy period')
  const settings = useAvailabilitySettings()
  const entry = useQuery({
    queryKey: keys.entry(entryId ?? 'new'),
    enabled: !isNew,
    retry: (count, err) => err.message !== 'missing' && count < 2,
    queryFn: async () => {
      const { data, error, response } = await api.GET('/api/availability/schedule/{entry_id}', {
        params: { path: { entry_id: entryId! } },
      })
      if (response.status === 404 || response.status === 422) throw new Error('missing')
      if (error || !data) throw new Error(friendlyError(error, 'we could not load this busy period.'))
      return data
    },
  })

  const title = isNew ? 'add busy period' : 'edit busy period'
  let body
  if (settings.isPending || (!isNew && entry.isPending)) body = <Loading />
  else if (!isNew && entry.isError)
    body =
      entry.error.message === 'missing' ? (
        <EmptyState title="this busy period is gone" action={<Button to="/availability/me">back to my schedule</Button>}>
          it may have been deleted.
        </EmptyState>
      ) : (
        <ErrorState message={entry.error.message} onRetry={() => entry.refetch()} />
      )
  else body = <BusyForm key={entryId ?? 'new'} period={entry.data} zone={preferredZone(settings.data)} />

  return (
    <ScreenBody screen="edit-busy-period">
      <Header title={title} back="/availability/me" />
      {body}
    </ScreenBody>
  )
}

const hhmm = (t: string) => t.slice(0, 5)

function addDays(iso: string, days: number) {
  const d = parseDate(iso)
  d.setDate(d.getDate() + days)
  return toIsoDate(d)
}

function BusyForm({ period, zone }: { period?: Period; zone: string }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [today] = useState(() => toIsoDate(new Date()))
  const [label, setLabel] = useState(period?.private_label ?? '')
  const [startDate, setStartDate] = useState(period?.start_date ?? today)
  const [days, setDays] = useState<number[]>(period?.repeat_weekdays ?? [])
  const [repeatUntil, setRepeatUntil] = useState(period?.repeat_until ?? '')
  const [start, setStart] = useState(period ? hhmm(period.start_time) : '09:00')
  const [end, setEnd] = useState(period ? hhmm(period.end_time) : '10:00')
  const [timeZone, setTimeZone] = useState(period?.time_zone ?? zone)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [idempotencyKey] = useState(() => crypto.randomUUID())

  const repeating = days.length > 0
  const until = repeatUntil || addDays(startDate || today, 7 * 12)

  function toggleDay(d: number) {
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()))
  }

  function check(): string | null {
    if (!startDate) return 'pick a date.'
    if (!start || !end) return 'pick a start and end time.'
    if (start === end) return "start and end time can't be the same."
    if (label.trim().length > 80) return 'keep the name under 80 letters.'
    if (repeating) {
      const span = (parseDate(until).getTime() - parseDate(startDate).getTime()) / 86_400_000
      if (span < 0) return 'the repeat must end after it starts.'
      if (span > 366) return 'a repeat can last up to one year.'
    }
    return null
  }

  function done(message: string) {
    qc.invalidateQueries({ queryKey: keys.schedule })
    qc.invalidateQueries({ queryKey: ['availability', 'family'] })
    if (period) qc.removeQueries({ queryKey: keys.entry(period.id) })
    navigate('/availability/me', { replace: true, state: { saved: message } })
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    const problem = check()
    if (problem) return setError(problem)
    setError(null)
    setBusy('save')
    const values = {
      private_label: label.trim() || null,
      start_date: startDate,
      start_time: start,
      end_time: end,
      time_zone: timeZone,
      repeat_weekdays: days,
      repeat_until: repeating ? until : null,
    }
    try {
      const res = period
        ? await api.PATCH('/api/availability/schedule/{entry_id}', {
            params: { path: { entry_id: period.id } },
            body: values,
          })
        : await api.POST('/api/availability/schedule', { body: { ...values, idempotency_key: idempotencyKey } })
      if (res.error || !res.data) {
        setBusy(null)
        return setError(friendlyError(res.error, "that didn't save. try again."))
      }
    } catch {
      setBusy(null)
      return setError("we couldn't reach the server. try again.")
    }
    done(period ? 'busy period updated.' : 'busy period added.')
  }

  async function remove() {
    if (!period) return
    setError(null)
    setBusy('delete')
    try {
      const res = await api.DELETE('/api/availability/schedule/{entry_id}', {
        params: { path: { entry_id: period.id } },
      })
      if (!res.response.ok && res.response.status !== 404) {
        setBusy(null)
        setConfirming(false)
        return setError(friendlyError(res.error, "that didn't delete. try again."))
      }
    } catch {
      setBusy(null)
      setConfirming(false)
      return setError("we couldn't reach the server. try again.")
    }
    done('busy period deleted.')
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-5" noValidate>
      <Field label="what is it?" hint="only you see this name.">
        {(id) => (
          <input
            id={id}
            value={label}
            maxLength={80}
            placeholder="class, work, nap…"
            onChange={(e) => setLabel(e.target.value)}
            className={cn(controlClass, 'placeholder:text-muted')}
          />
        )}
      </Field>

      <Field label={repeating ? 'starts on' : 'date'}>
        {(id) => (
          <input id={id} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={controlClass} />
        )}
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 font-sans text-[1.3rem] leading-none">repeat</legend>
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((d, i) => {
            const on = days.includes(i)
            return (
              <button
                key={d.full}
                type="button"
                aria-pressed={on}
                aria-label={d.full}
                onClick={() => toggleDay(i)}
                className={cn(
                  'grid h-12 place-items-center rounded-full border-2 border-ink font-sans text-[1.25rem]',
                  on ? 'bg-sun text-black' : 'bg-paper',
                )}
              >
                {d.short}
              </button>
            )
          })}
        </div>
        <p className="font-sans text-[1.05rem] leading-snug text-muted">
          {repeating ? 'repeats on the days you picked.' : 'pick days to repeat every week, or leave empty for one day.'}
        </p>
      </fieldset>

      {repeating && (
        <Field label="repeat until" hint="up to one year.">
          {(id) => (
            <input
              id={id}
              type="date"
              value={until}
              min={startDate}
              max={startDate ? addDays(startDate, 366) : undefined}
              onChange={(e) => setRepeatUntil(e.target.value)}
              className={controlClass}
            />
          )}
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="start">
          {(id) => <input id={id} type="time" value={start} onChange={(e) => setStart(e.target.value)} className={controlClass} />}
        </Field>
        <Field label="end">
          {(id) => <input id={id} type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={controlClass} />}
        </Field>
      </div>
      {start && end && end < start && (
        <p className="-mt-3 font-sans text-[1.05rem] text-muted">ends the next day.</p>
      )}

      <TimeZoneSelect value={timeZone} onChange={setTimeZone} />

      <FormError>{error}</FormError>

      {confirming ? (
        <Card className="flex flex-col gap-3">
          <p className="font-hand text-[1.6rem] leading-tight">delete this busy period?</p>
          <Button onClick={remove} disabled={busy !== null}>
            {busy === 'delete' ? 'deleting…' : 'yes, delete'}
          </Button>
          <Button tone="secondary" onClick={() => setConfirming(false)} disabled={busy !== null}>
            keep it
          </Button>
        </Card>
      ) : (
        <div className={cn('grid gap-3', period ? 'grid-cols-2' : 'grid-cols-1')}>
          <Button type="submit" disabled={busy !== null}>
            {busy === 'save' ? 'saving…' : 'save'}
          </Button>
          {period && (
            <Button tone="secondary" onClick={() => setConfirming(true)} disabled={busy !== null}>
              delete
            </Button>
          )}
        </div>
      )}
    </form>
  )
}
