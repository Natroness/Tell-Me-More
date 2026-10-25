import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Cake, Flower2, Heart, PartyPopper, type LucideIcon } from 'lucide-react'
import { api, type Schemas } from '@/lib/api'
import { formatApiError } from '@/lib/apiError'

export type Category = Schemas['CreateEvent']['category']
export type Occurrence = Schemas['EventOccurrence']

export const CATEGORIES: { id: Category; label: string; icon: LucideIcon }[] = [
  { id: 'birthday', label: 'birthday', icon: Cake },
  { id: 'anniversary', label: 'anniversary', icon: Heart },
  { id: 'family_function', label: 'family gathering', icon: PartyPopper },
  { id: 'cultural_function', label: 'cultural celebration', icon: Flower2 },
  { id: 'other', label: 'other', icon: CalendarDays },
]

export function category(id: Category) {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1]
}

export const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const LONG_WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

const pad = (n: number) => String(n).padStart(2, '0')

/** Dates stay as YYYY-MM-DD strings so the user's time zone never shifts a day. */
export function iso(year: number, month: number, day: number) {
  return `${year}-${pad(month + 1)}-${pad(day)}`
}

export function parseIso(value: string) {
  const [y, m, d] = value.split('-').map(Number)
  return { year: y, month: m - 1, day: d }
}

export function todayIso() {
  const now = new Date()
  return iso(now.getFullYear(), now.getMonth(), now.getDate())
}

export function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

/** Blank cells before day 1 in a monday-first week. */
export function leadingBlanks(year: number, month: number) {
  return (new Date(year, month, 1).getDay() + 6) % 7
}

export function longDate(value: string, withYear = true) {
  const { year, month, day } = parseIso(value)
  const weekday = LONG_WEEKDAYS[new Date(year, month, day).getDay()]
  return `${weekday}, ${MONTHS[month]} ${day}${withYear ? `, ${year}` : ''}`
}

export function shortDate(value: string, withYear = false) {
  const { year, month, day } = parseIso(value)
  return `${MONTHS[month].slice(0, 3)} ${day}${withYear ? `, ${year}` : ''}`
}

export function browserZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/** "18:30:00" → "6:30 pm", plus the zone when it is not the viewer's own. */
export function clockTime(time: string, zone?: string | null) {
  const [h, m] = time.split(':').map(Number)
  const label = `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'am' : 'pm'}`
  return zone && zone !== browserZone() ? `${label} (${zone.replace(/_/g, ' ').toLowerCase()})` : label
}

/** Same February 29 rule as the backend's annual projection. */
export function nextOccurrence(date: string, from = todayIso()) {
  const { month, day } = parseIso(date)
  const start = parseIso(from).year
  for (const year of [start, start + 1]) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
    const candidate = iso(year, month, month === 1 && day === 29 && !leap ? 28 : day)
    if (candidate >= from) return candidate
  }
  return date
}

const PAGE = 200

async function fetchOccurrences(familyId: string, start: string, end: string) {
  const all: Occurrence[] = []
  for (let offset = 0; offset < PAGE * 10; offset += PAGE) {
    const { data, error } = await api.GET('/api/families/{family_id}/events', {
      params: { path: { family_id: familyId }, query: { start, end, limit: PAGE, offset } },
    })
    if (error || !data) throw new Error(formatApiError(error, 'we could not load your important dates.'))
    all.push(...data)
    if (data.length < PAGE) break
  }
  return all
}

export function useOccurrences(familyId: string | undefined, start: string, end: string) {
  return useQuery({
    queryKey: ['events', familyId, start, end],
    enabled: !!familyId,
    queryFn: () => fetchOccurrences(familyId!, start, end),
  })
}

export function useEvent(eventId: string | undefined) {
  return useQuery({
    queryKey: ['event', eventId],
    enabled: !!eventId,
    queryFn: async () => {
      const { data, error, response } = await api.GET('/api/events/{event_id}', {
        params: { path: { event_id: eventId! } },
      })
      if (response.status === 404) return null
      if (error || !data) throw new Error(formatApiError(error, 'we could not load this date.'))
      return data
    },
  })
}

export function countByDay(occurrences: Occurrence[] | undefined) {
  const map = new Map<string, number>()
  for (const o of occurrences ?? []) map.set(o.occurrence_date, (map.get(o.occurrence_date) ?? 0) + 1)
  return map
}
