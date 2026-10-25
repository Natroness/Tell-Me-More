import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { Avatar, Button, EmptyState, ErrorState, FormError, Header, Loading, Notice, ScreenBody } from '@/components/ui/chrome'
import { TextField } from '@/components/ui/fields'
import { api, type Schemas } from '@/lib/api'
import { formatApiError } from '@/lib/apiError'
import { useAuth } from '@/lib/auth'
import { useFamilyTree } from '@/lib/family'
import { useScreenTitle } from '@/lib/useScreenTitle'
import { cn } from '@/lib/utils'
import { FamilyGate } from './FamilyGate'
import { CATEGORIES, browserZone, todayIso, useEvent, type Category } from './shared'

const controlClass =
  'hand-box h-14 w-full border-[1.5px] border-ink/40 bg-paper px-4 font-sans text-[1.3rem] text-ink outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-sun'

type Values = {
  title: string
  category: Category
  date: string
  time: string
  timeZone: string | null
  people: string[]
  repeats: boolean
  notes: string
}

/** Screen 20 (new): /dates/new, optionally with ?date=YYYY-MM-DD. */
export function NewEvent() {
  useScreenTitle('add event')
  const [params] = useSearchParams()
  const date = params.get('date')
  return (
    <ScreenBody screen="event-new">
      <Header title="add event" />
      <FamilyGate>
        {(familyId) => (
          <EventForm
            familyId={familyId}
            initial={{
              title: '',
              category: 'birthday',
              date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayIso(),
              time: '',
              timeZone: null,
              people: [],
              repeats: true,
              notes: '',
            }}
          />
        )}
      </FamilyGate>
    </ScreenBody>
  )
}

/** Screen 20 (edit): only the creator may change an event. */
export function EditEvent() {
  useScreenTitle('edit event')
  const { eventId } = useParams()
  const { session } = useAuth()
  const event = useEvent(eventId)
  const e = event.data
  return (
    <ScreenBody screen="event-edit">
      <Header title="edit event" />
      {event.isPending ? (
        <Loading />
      ) : event.isError ? (
        <ErrorState message={event.error.message} onRetry={() => event.refetch()} />
      ) : !e ? (
        <EmptyState title="this date is gone" action={<Button to="/dates" tone="secondary">back to dates</Button>}>
          it may have been removed.
        </EmptyState>
      ) : e.created_by !== session?.user.id ? (
        <Notice title="you can't edit this one">only the person who added this date can change it.</Notice>
      ) : (
        <EventForm
          key={e.id}
          familyId={e.family_id}
          eventId={e.id}
          initial={{
            title: e.title,
            category: e.category,
            date: e.date,
            time: e.time?.slice(0, 5) ?? '',
            timeZone: e.time_zone ?? null,
            people: e.related_person_ids ?? [],
            repeats: e.repeats_annually ?? false,
            notes: e.description ?? '',
          }}
        />
      )}
    </ScreenBody>
  )
}

function EventForm({ familyId, eventId, initial }: { familyId: string; eventId?: string; initial: Values }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const tree = useFamilyTree(familyId)
  const [v, setV] = useState(initial)
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ids = { category: useId(), date: useId(), time: useId(), notes: useId(), repeat: useId() }
  const set = (patch: Partial<Values>) => setV((cur) => ({ ...cur, ...patch }))
  const cultural = v.category === 'cultural_function'

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!v.title.trim()) return setError('give this date a name.')
    if (!v.date) return setError('pick a date.')
    setSaving(true)
    setError(null)
    const fields = {
      title: v.title.trim(),
      category: v.category,
      date: v.date,
      time: v.time || null,
      time_zone: v.time ? (v.timeZone ?? browserZone()) : null,
      description: v.notes.trim() || null,
      related_person_ids: v.people,
      repeats_annually: cultural ? false : v.repeats,
    } satisfies Schemas['UpdateEvent']
    try {
      const { data, error } = eventId
        ? await api.PATCH('/api/events/{event_id}', { params: { path: { event_id: eventId } }, body: fields })
        : await api.POST('/api/families/{family_id}/events', {
            params: { path: { family_id: familyId } },
            body: { ...fields, idempotency_key: idempotencyKey },
          })
      if (error || !data) {
        setError(formatApiError(error, 'we could not save this date. try again.'))
        return
      }
      qc.setQueryData(['event', data.id], data)
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['events'] }),
        qc.invalidateQueries({ queryKey: ['timeline'] }),
      ])
      navigate(`/events/${data.id}`, { replace: true })
    } catch {
      setError('we could not reach the server. check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  const people = tree.data?.people ?? []

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <TextField label="event title" value={v.title} onChange={(title) => set({ title })} />

      <Field label="type" htmlFor={ids.category}>
        <div className="relative">
          <select
            id={ids.category}
            value={v.category}
            onChange={(e) => {
              const next = e.target.value as Category
              set({ category: next, ...(next === 'cultural_function' ? { repeats: false } : {}) })
            }}
            className={`${controlClass} appearance-none pr-12`}
          >
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <span aria-hidden className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 font-sans text-2xl">
            ▾
          </span>
        </div>
      </Field>

      <Field label="date" htmlFor={ids.date}>
        <input
          id={ids.date}
          type="date"
          required
          value={v.date}
          onChange={(e) => set({ date: e.target.value })}
          className={controlClass}
        />
      </Field>

      <Field label="time (optional)" htmlFor={ids.time}>
        <div className="flex items-center gap-2">
          <input
            id={ids.time}
            type="time"
            value={v.time}
            onChange={(e) => set({ time: e.target.value })}
            className={controlClass}
          />
          {v.time && (
            <button
              type="button"
              onClick={() => set({ time: '' })}
              className="min-h-12 shrink-0 px-2 font-sans text-[1.2rem] underline underline-offset-4"
            >
              clear
            </button>
          )}
        </div>
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 font-sans text-[1.35rem] leading-none">with (family members)</legend>
        {tree.isPending ? (
          <p className="font-sans text-[1.1rem] text-muted">loading your family…</p>
        ) : tree.isError ? (
          <Notice tone="error" onRetry={() => tree.refetch()}>
            we could not load your family list.
          </Notice>
        ) : people.length === 0 ? (
          <p className="font-sans text-[1.1rem] text-muted">add people to your family tree to tag them here.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {people.map((p) => {
              const on = v.people.includes(p.id)
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => set({ people: on ? v.people.filter((id) => id !== p.id) : [...v.people, p.id] })}
                    className={cn(
                      'hand-pill flex min-h-12 items-center gap-2 border-2 py-1 pr-4 pl-1 font-sans text-[1.15rem] leading-tight',
                      on ? 'border-ink bg-sun text-black' : 'border-ink/40',
                    )}
                  >
                    <Avatar name={p.display_name} src={p.avatar_url} size="sm" />
                    <span className="break-words">{p.id === tree.data?.me ? 'me' : p.display_name}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={ids.repeat} className="font-sans text-[1.35rem] leading-tight">
            repeat every year
          </label>
          <button
            id={ids.repeat}
            type="button"
            role="switch"
            aria-checked={!cultural && v.repeats}
            disabled={cultural}
            onClick={() => set({ repeats: !v.repeats })}
            className={cn(
              'relative h-9 w-16 shrink-0 rounded-full border-2 border-ink transition-colors disabled:opacity-50',
              !cultural && v.repeats ? 'bg-sun' : 'bg-paper',
            )}
          >
            <span
              className={cn(
                'absolute top-1/2 size-6 -translate-y-1/2 rounded-full border-2 border-ink bg-paper transition-all',
                !cultural && v.repeats ? 'left-[calc(100%-1.75rem)]' : 'left-0.5',
              )}
            />
          </button>
        </div>
        {cultural && (
          <p className="font-sans text-[1.05rem] leading-snug text-muted">
            cultural celebrations move each year, so add each year's date on its own.
          </p>
        )}
      </div>

      <Field label="notes (optional)" htmlFor={ids.notes}>
        <textarea
          id={ids.notes}
          value={v.notes}
          maxLength={1000}
          rows={3}
          onChange={(e) => set({ notes: e.target.value })}
          placeholder="family lunch together!"
          className={`${controlClass} h-auto min-h-28 py-3 leading-snug`}
        />
      </Field>

      <FormError>{error}</FormError>
      <Button type="submit" disabled={saving}>
        {saving ? 'saving…' : 'save'}
      </Button>
    </form>
  )
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="font-sans text-[1.35rem] leading-none">
        {label}
      </label>
      {children}
    </div>
  )
}
