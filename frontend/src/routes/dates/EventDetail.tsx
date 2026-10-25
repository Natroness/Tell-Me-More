import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router'
import { Pencil, Repeat } from 'lucide-react'
import {
  Avatar,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  FormError,
  Header,
  Loading,
  ScreenBody,
  TextButton,
} from '@/components/ui/chrome'
import { api } from '@/lib/api'
import { formatApiError } from '@/lib/apiError'
import { useAuth } from '@/lib/auth'
import { useFamilyTree } from '@/lib/family'
import { useScreenTitle } from '@/lib/useScreenTitle'
import { category, clockTime, longDate, nextOccurrence, parseIso, todayIso, useEvent } from './shared'

/** Screen 19: one important date, with edit and delete for whoever added it. */
export function EventDetail() {
  useScreenTitle('important date')
  const { eventId } = useParams()
  const event = useEvent(eventId)
  return (
    <ScreenBody screen="event">
      <Header title="important date" />
      {event.isPending ? (
        <Loading />
      ) : event.isError ? (
        <ErrorState message={event.error.message} onRetry={() => event.refetch()} />
      ) : !event.data ? (
        <EmptyState
          title="this date is gone"
          action={
            <Button to="/dates" tone="secondary">
              back to dates
            </Button>
          }
        >
          it may have been removed.
        </EmptyState>
      ) : (
        <Details event={event.data} />
      )}
    </ScreenBody>
  )
}

function Details({ event }: { event: NonNullable<ReturnType<typeof useEvent>['data']> }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { session } = useAuth()
  const tree = useFamilyTree(event.family_id)
  const [confirming, setConfirming] = useState(false)
  const mine = !!session && event.created_by === session.user.id
  const kind = category(event.category)
  const Icon = kind.icon
  const shownDate = event.repeats_annually ? nextOccurrence(event.date) : event.date
  const firstYear = parseIso(event.date).year
  const people = (event.related_person_ids ?? []).map(
    (id) => tree.data?.people.find((p) => p.id === id) ?? { id, display_name: null },
  )

  const remove = useMutation({
    mutationFn: async () => {
      const { error, response } = await api.DELETE('/api/events/{event_id}', {
        params: { path: { event_id: event.id } },
      })
      if (!response.ok) throw new Error(formatApiError(error, 'we could not delete this date. try again.'))
    },
    onSuccess: async () => {
      qc.removeQueries({ queryKey: ['event', event.id] })
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['events'] }),
        qc.invalidateQueries({ queryKey: ['timeline'] }),
      ])
      navigate(`/dates?month=${shownDate.slice(0, 7)}`, { replace: true })
    },
  })

  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <span className="grid size-24 place-items-center rounded-full border-2 border-ink bg-sun text-black" aria-hidden>
        <Icon className="size-12" strokeWidth={2} />
      </span>
      <div className="flex flex-col items-center gap-2">
        <h2 className="font-hand text-[2.3rem] leading-[1.05] break-words">{event.title}</h2>
        <p className="font-sans text-[1.35rem] leading-snug">
          {longDate(shownDate)}
          {event.time && ` · ${clockTime(event.time, event.time_zone)}`}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Chip>{kind.label}</Chip>
          {event.repeats_annually && (
            <Chip tone="sun">
              <Repeat className="size-3.5" aria-hidden /> every year
              {firstYear < parseIso(todayIso()).year && ` · since ${firstYear}`}
            </Chip>
          )}
        </div>
      </div>

      {people.length > 0 && (
        <section className="w-full" aria-label="people">
          <ul className="flex flex-wrap justify-center gap-4">
            {people.map((p) => (
              <li key={p.id} className="flex w-20 flex-col items-center gap-1">
                <Avatar name={p.display_name} />
                <span className="w-full font-sans text-[1.1rem] leading-tight break-words">
                  {p.display_name ?? (tree.isPending ? '…' : 'family member')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {event.description && (
        <Card className="w-full text-left">
          <p className="font-sans text-[1.25rem] leading-snug break-words whitespace-pre-line">{event.description}</p>
        </Card>
      )}

      <div className="mt-2 flex w-full flex-col gap-3">
        {mine ? (
          <>
            <Button to={`/events/${event.id}/edit`} tone="secondary">
              <Pencil className="size-6" strokeWidth={2.2} aria-hidden /> edit
            </Button>
            {confirming ? (
              <Card className="flex flex-col gap-3">
                <p className="font-hand text-[1.6rem] leading-tight">delete this date for everyone?</p>
                <FormError>{remove.error?.message}</FormError>
                <Button onClick={() => remove.mutate()} disabled={remove.isPending}>
                  {remove.isPending ? 'deleting…' : 'yes, delete'}
                </Button>
                <TextButton onClick={() => setConfirming(false)} disabled={remove.isPending}>
                  keep it
                </TextButton>
              </Card>
            ) : (
              <TextButton onClick={() => setConfirming(true)}>delete</TextButton>
            )}
          </>
        ) : (
          <p className="font-sans text-[1.1rem] leading-snug text-muted">only the person who added this date can change it.</p>
        )}
      </div>
    </div>
  )
}
