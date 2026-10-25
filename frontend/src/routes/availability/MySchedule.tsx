import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Lock, Plus } from 'lucide-react'
import { Button, EmptyState, ErrorState, FormError, Header, Loading, Notice, ScreenBody } from '@/components/ui/chrome'
import { api, type Schemas } from '@/lib/api'
import { useScreenTitle } from '@/lib/useScreenTitle'
import { SelectField, Switch, TimeZoneSelect } from './ui'
import {
  formatClock,
  formatDay,
  formatInstant,
  friendlyError,
  keys,
  preferredZone,
  repeatLabel,
  useAvailabilitySettings,
  useBusyPeriods,
  zoneLabel,
} from './data'

type Settings = Schemas['AvailabilitySettings']

type Choice = { value: string; label: string; status: 'free' | 'busy'; until: () => Date }

function overrideChoices(now = new Date()): Choice[] {
  const hours = (h: number) => () => new Date(Date.now() + h * 3_600_000)
  const endOfDay = () => {
    const d = new Date()
    d.setHours(24, 0, 0, 0)
    return d
  }
  const at6 = () => {
    const d = new Date()
    d.setHours(18, 0, 0, 0)
    return d
  }
  const choices: Choice[] = [
    { value: 'busy-1h', label: 'busy for 1 hour', status: 'busy', until: hours(1) },
    { value: 'busy-3h', label: 'busy for 3 hours', status: 'busy', until: hours(3) },
    { value: 'busy-day', label: 'busy for the rest of today', status: 'busy', until: endOfDay },
    { value: 'free-1h', label: 'free for 1 hour', status: 'free', until: hours(1) },
  ]
  if (now.getHours() >= 11 && now.getHours() < 17)
    choices.push({ value: 'free-afternoon', label: 'free for the afternoon', status: 'free', until: at6 })
  choices.push({ value: 'free-day', label: 'free for the rest of today', status: 'free', until: endOfDay })
  return choices
}

export function MyScheduleScreen() {
  useScreenTitle('my schedule')
  const qc = useQueryClient()
  const location = useLocation()
  const saved = (location.state as { saved?: string } | null)?.saved
  const settings = useAvailabilitySettings()
  const schedule = useBusyPeriods()
  const [pending, setPending] = useState<'sharing' | 'zone' | 'override' | 'configured' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const s = settings.data
  const zone = preferredZone(s)

  async function patch(body: Schemas['UpdateAvailabilitySettings'], what: typeof pending) {
    setPending(what)
    setError(null)
    const { data, error } = await api.PATCH('/api/availability/settings', { body }).catch(() => ({ data: undefined, error: undefined }))
    setPending(null)
    if (error || !data) return setError(friendlyError(error, "that didn't save. try again."))
    qc.setQueryData(keys.settings, data)
    qc.invalidateQueries({ queryKey: ['availability', 'family'] })
  }

  function setSharing(on: boolean) {
    const body: Schemas['UpdateAvailabilitySettings'] = { sharing_enabled: on }
    if (on) body.schedule_configured = true
    if (on && !s?.updated_at) body.time_zone = zone
    return patch(body, 'sharing')
  }

  async function setOverride(value: string) {
    if (value === 'current') return
    setPending('override')
    setError(null)
    let result: { data?: Settings; error?: unknown }
    try {
      if (value === 'none') {
        const res = await api.DELETE('/api/availability/override')
        result = res.response.ok ? { data: { ...s, override_status: null, override_expires_at: null } } : { error: res.error ?? {} }
      } else {
        const choice = overrideChoices().find((c) => c.value === value)!
        result = await api.PUT('/api/availability/override', {
          body: { status: choice.status, expires_at: choice.until().toISOString() },
        })
      }
    } catch {
      result = { error: {} }
    }
    setPending(null)
    if (result.error || !result.data) return setError(friendlyError(result.error, "that didn't save. try again."))
    qc.setQueryData(keys.settings, result.data)
    qc.invalidateQueries({ queryKey: keys.settings })
    qc.invalidateQueries({ queryKey: ['availability', 'family'] })
  }

  if (settings.isPending)
    return (
      <ScreenBody screen="my-schedule">
        <Header title="my private schedule" back="/availability" />
        <Loading />
      </ScreenBody>
    )
  if (settings.isError)
    return (
      <ScreenBody screen="my-schedule">
        <Header title="my private schedule" back="/availability" />
        <ErrorState message={settings.error.message} onRetry={() => settings.refetch()} />
      </ScreenBody>
    )

  const active = s?.override_status && s.override_expires_at
  const overrideOptions = [
    ...(active
      ? [{ value: 'current', label: `${s.override_status} until ${formatInstant(s.override_expires_at!)}` }]
      : []),
    { value: 'none', label: active ? 'clear (use my schedule)' : 'not set' },
    ...overrideChoices().map(({ value, label }) => ({ value, label })),
  ]
  const periods = schedule.data ?? []

  return (
    <ScreenBody screen="my-schedule">
      <Header title="my private schedule" back="/availability" />
      <div className="flex flex-col gap-5">
        <p className="flex items-center gap-2 font-sans text-[1.2rem] leading-snug">
          <Lock className="size-5 shrink-0" strokeWidth={2.2} aria-hidden />
          only you can see this. relatives only see free, busy, or not shared.
        </p>
        {saved && <Notice tone="success">{saved}</Notice>}

        <div className="flex flex-col gap-2">
          <Switch
            label="share my availability"
            checked={!!s?.sharing_enabled}
            disabled={pending !== null}
            onChange={setSharing}
          />
          <p className="font-sans text-[1.05rem] leading-snug text-muted">
            {s?.sharing_enabled
              ? 'relatives see if you are free or busy right now, never the details.'
              : 'off: relatives see you as "not shared".'}
          </p>
          {s?.sharing_enabled && !s.schedule_configured && (
            <Notice>
              relatives still see "not shared" until your schedule is ready.{' '}
              <button
                type="button"
                className="underline underline-offset-4"
                disabled={pending !== null}
                onClick={() => patch({ schedule_configured: true }, 'configured')}
              >
                my schedule is ready
              </button>
            </Notice>
          )}
        </div>

        <TimeZoneSelect
          value={zone}
          disabled={pending !== null}
          onChange={(z) => patch({ time_zone: z }, 'zone')}
          hint={!s?.updated_at ? 'from this device' : undefined}
        />

        <section className="flex flex-col gap-3" aria-label="busy periods">
          <h2 className="font-hand text-[1.7rem] leading-none">busy periods</h2>
          {schedule.isPending ? (
            <Loading label="loading your schedule…" />
          ) : schedule.isError ? (
            <ErrorState message={schedule.error.message} onRetry={() => schedule.refetch()} />
          ) : periods.length === 0 ? (
            <EmptyState title="no busy periods yet">add the times you're usually busy, like work or class.</EmptyState>
          ) : (
            <ul className="flex flex-col gap-3">
              {periods.map((p) => (
                <li key={p.id}>
                  <BusyCard period={p} zone={zone} />
                </li>
              ))}
            </ul>
          )}
          <Button to="/availability/busy/new">
            <Plus className="size-6" strokeWidth={2.4} aria-hidden />
            add busy period
          </Button>
        </section>

        <SelectField
          label="temporary status"
          value={active ? 'current' : 'none'}
          disabled={pending !== null}
          onChange={setOverride}
          options={overrideOptions}
          hint={active ? 'this replaces your schedule until it ends.' : 'override your schedule for a little while.'}
        />
        {pending && <p className="text-center font-sans text-[1.1rem] text-muted" role="status">saving…</p>}
        <FormError>{error}</FormError>
      </div>
    </ScreenBody>
  )
}

function BusyCard({ period, zone }: { period: Schemas['BusyPeriod']; zone: string }) {
  const days = period.repeat_weekdays ?? []
  const when = days.length
    ? `${repeatLabel(days)}${period.repeat_until ? ` · until ${formatDay(period.repeat_until, false)}` : ''}`
    : formatDay(period.start_date)
  const overnight = period.end_time < period.start_time
  return (
    <Link
      to={`/availability/busy/${period.id}`}
      className="hand-box flex min-h-20 items-center gap-3 border-2 border-ink p-3 transition-colors hover:bg-ink/5"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-hand text-[1.55rem] leading-tight break-words">{period.private_label || 'busy'}</span>
        <span className="font-sans text-[1.15rem] leading-snug break-words">{when}</span>
        <span className="font-sans text-[1.15rem] leading-snug">
          {formatClock(period.start_time)} – {formatClock(period.end_time)}
          {overnight && ' (next day)'}
        </span>
        {period.time_zone !== zone && (
          <span className="font-sans text-[1rem] break-words text-muted">{zoneLabel(period.time_zone)}</span>
        )}
      </span>
      <ChevronRight className="size-6 shrink-0" strokeWidth={2.2} aria-hidden />
    </Link>
  )
}
