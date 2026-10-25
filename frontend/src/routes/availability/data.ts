import { useQuery } from '@tanstack/react-query'
import { api, type Schemas } from '@/lib/api'
import { formatApiError } from '@/lib/apiError'

export type Status = Schemas['FamilyAvailability']['status']

export const controlClass =
  'hand-box h-14 w-full min-w-0 border-[1.5px] border-ink/40 bg-paper px-4 font-sans text-[1.3rem] text-ink outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-sun disabled:opacity-60'

export const keys = {
  settings: ['availability', 'settings'] as const,
  schedule: ['availability', 'schedule'] as const,
  entry: (id: string) => ['availability', 'entry', id] as const,
  family: (familyId: string | undefined) => ['availability', 'family', familyId] as const,
}

const FRIENDLY: [string, string][] = [
  ['cannot be equal', "start and end time can't be the same."],
  ['repeat_until is required', 'pick the date the repeat ends.'],
  ['must end within', 'a repeat can last up to one year.'],
  ['requires at least one repeat weekday', 'pick at least one day to repeat on.'],
  ['does not exist in that time zone', 'that time is skipped by a clock change on this date. pick another time.'],
  ['valid iana time zone', 'pick a time zone from the list.'],
  ['private_label cannot be blank', 'add a name or leave it empty.'],
  ['more than 200 busy periods', 'you can keep up to 200 busy periods. delete an old one first.'],
  ['override expiry must be future', 'that time has already passed. pick another option.'],
  ['cannot last more than', 'a temporary status can last up to 7 days.'],
  ['busy period not found', 'that busy period no longer exists.'],
  ['not a member', "you're not part of this family."],
]

export function friendlyError(error: unknown, fallback: string): string {
  const raw = formatApiError(error, fallback).replace(/^value error,\s*/i, '')
  const lower = raw.toLowerCase()
  const hit = FRIENDLY.find(([needle]) => lower.includes(needle))
  if (hit) return hit[1]
  if (/[_{}]|internal server error/i.test(raw)) return fallback
  return raw
}

export function useAvailabilitySettings() {
  return useQuery({
    queryKey: keys.settings,
    queryFn: async () => {
      const { data, error } = await api.GET('/api/availability/settings')
      if (error || !data) throw new Error(friendlyError(error, 'we could not load your availability settings.'))
      return data
    },
  })
}

export function useBusyPeriods() {
  return useQuery({
    queryKey: keys.schedule,
    queryFn: async () => {
      const { data, error } = await api.GET('/api/availability/schedule', { params: { query: { limit: 200 } } })
      if (error || !data) throw new Error(friendlyError(error, 'we could not load your schedule.'))
      return data
    },
  })
}

export function useFamilyAvailability(familyId: string | undefined) {
  return useQuery({
    queryKey: keys.family(familyId),
    enabled: !!familyId,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await api.GET('/api/families/{family_id}/availability', {
        params: { path: { family_id: familyId! }, query: { limit: 200 } },
      })
      if (error || !data) throw new Error(friendlyError(error, "we could not load your family's availability."))
      return data
    },
  })
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Saved zone, or this device's zone when the user has never saved settings. */
export function preferredZone(settings: Schemas['AvailabilitySettings'] | undefined) {
  return settings?.updated_at && settings.time_zone ? settings.time_zone : browserTimeZone()
}

let zones: string[] | null = null
export function timeZones(...ensure: (string | undefined)[]): string[] {
  if (!zones) {
    try {
      zones = Intl.supportedValuesOf('timeZone')
    } catch {
      zones = []
    }
  }
  const extra = ['UTC', ...ensure].filter((z): z is string => !!z && !zones!.includes(z))
  return [...new Set([...extra, ...zones])]
}

export function zoneLabel(zone: string) {
  return zone.replace(/_/g, ' ').replace(/\//g, ' / ').toLowerCase()
}

export const WEEKDAYS = [
  { short: 'M', name: 'mon', full: 'monday' },
  { short: 'T', name: 'tue', full: 'tuesday' },
  { short: 'W', name: 'wed', full: 'wednesday' },
  { short: 'T', name: 'thu', full: 'thursday' },
  { short: 'F', name: 'fri', full: 'friday' },
  { short: 'S', name: 'sat', full: 'saturday' },
  { short: 'S', name: 'sun', full: 'sunday' },
]

export function parseDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function toIsoDate(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function formatDay(iso: string, weekday = true) {
  return parseDate(iso)
    .toLocaleDateString('en-US', { weekday: weekday ? 'long' : undefined, month: 'short', day: 'numeric' })
    .toLowerCase()
}

export function formatClock(time: string) {
  const [h, m] = time.split(':').map(Number)
  const suffix = h < 12 ? 'am' : 'pm'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`
}

export function formatInstant(iso: string) {
  const at = new Date(iso)
  const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()
  if (toIsoDate(at) === toIsoDate(new Date())) return time
  return `${at.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toLowerCase()}, ${time}`
}

export function relativeTime(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export function repeatLabel(days: number[]) {
  const set = [...days].sort()
  if (set.length === 7) return 'every day'
  if (set.join() === '0,1,2,3,4') return 'weekdays'
  if (set.join() === '5,6') return 'weekends'
  return set.map((d) => WEEKDAYS[d].name).join(', ')
}

export const STATUS: Record<Status, { short: string; big: string }> = {
  free_now: { short: 'free now', big: 'free right now' },
  busy_now: { short: 'busy now', big: 'busy right now' },
  not_shared: { short: 'not shared', big: 'not shared' },
}
