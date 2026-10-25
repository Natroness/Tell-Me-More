import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useLocation, useParams, useSearchParams } from 'react-router'
import {
  Avatar,
  Button,
  EmptyState,
  ErrorState,
  Header,
  HandLink,
  Loading,
  ScreenBody,
} from '@/components/ui/chrome'
import { api } from '@/lib/api'
import { useFamily } from '@/lib/family'
import { useScreenTitle } from '@/lib/useScreenTitle'
import { cn } from '@/lib/utils'
import { usePeople } from '@/routes/capture/data'
import { ObjectThumb } from '@/routes/capture/shared'
import { SendRequest } from '@/routes/capture/SendRequest'

/** Screen 10 (who might know?) then screen 11 (send a request) once someone is picked. */
export function ChooseStoryteller() {
  const { heirloomId } = useParams() as { heirloomId: string }
  const location = useLocation()
  const captureMediaId = (location.state as { captureMediaId?: string } | null)?.captureMediaId
  const [params, setParams] = useSearchParams()
  const to = params.get('to')
  const { data: family, isLoading: familyLoading } = useFamily()
  const [selected, setSelected] = useState('')

  const detail = useQuery({
    queryKey: ['heirloom', heirloomId],
    queryFn: async () =>
      (await api.GET('/api/heirlooms/{heirloom_id}', {
        params: { path: { heirloom_id: heirloomId } },
      })).data,
  })
  const people = usePeople(family?.id)
  const others = people.people.filter((p) => p.display_name && p.relation !== 'you')
  const person = to ? others.find((p) => p.id === to) : undefined

  useScreenTitle(person ? 'send a request' : 'who might know?')

  if (person)
    return (
      <SendRequest
        key={person.id}
        heirloomId={heirloomId}
        detail={detail.data}
        person={person}
        captureMediaId={captureMediaId}
      />
    )

  const loading = familyLoading || people.isLoading
  const heirloom = detail.data?.heirloom

  return (
    <ScreenBody screen="choose-storyteller">
      <Header title="who might know?" />
      {heirloom && (
        <div className="mb-4 flex items-center gap-3">
          <ObjectThumb src={heirloom.cover_url} className="size-16" />
          <p className="min-w-0 font-sans text-[1.25rem] leading-snug break-words">
            who could tell the story of {heirloom.title ?? 'this object'}?
          </p>
        </div>
      )}
      {loading ? (
        <Loading label="finding your family…" />
      ) : people.isError ? (
        <ErrorState message={people.error.message} onRetry={() => people.refetch()} />
      ) : others.length === 0 ? (
        <EmptyState
          title="no one to ask yet"
          action={<Button to="/family">invite a family member</Button>}
        >
          your object is saved. invite a relative first, then come back to ask them.
        </EmptyState>
      ) : (
        <>
          <div role="radiogroup" aria-label="storyteller" className="grid grid-cols-3 gap-x-2 gap-y-4">
            {others.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={selected === p.id}
                onClick={() => setSelected(p.id)}
                className={cn(
                  'hand-box flex flex-col items-center gap-1.5 border-2 px-1 py-3',
                  selected === p.id ? 'border-ink bg-sun text-black' : 'border-transparent',
                )}
              >
                <Avatar name={p.display_name} src={p.avatar_url} size="lg" highlight={selected === p.id} />
                <span className="w-full text-center font-sans text-[1.25rem] leading-tight break-words">
                  {p.display_name}
                </span>
                {p.relation_label && (
                  <span
                    className={cn(
                      'w-full text-center font-sans text-[1rem] leading-tight break-words',
                      selected !== p.id && 'text-muted',
                    )}
                  >
                    {p.relation_label}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="mt-auto flex flex-col gap-2 pt-6">
            <Button
              disabled={!selected}
              onClick={() => setParams({ to: selected }, { state: location.state })}
            >
              next →
            </Button>
            <HandLink to="/family">invite someone else</HandLink>
          </div>
        </>
      )}
    </ScreenBody>
  )
}
