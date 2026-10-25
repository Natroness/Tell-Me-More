import { Link } from 'react-router'
import { ChevronRight } from 'lucide-react'
import { Avatar, Button, EmptyState, ErrorState, Header, Loading, Notice, ScreenBody } from '@/components/ui/chrome'
import { useFamily, useFamilyTree } from '@/lib/family'
import { useScreenTitle } from '@/lib/useScreenTitle'
import { STATUS, useAvailabilitySettings, useFamilyAvailability } from './data'
import { StatusDot } from './ui'

export function FamilyAvailabilityScreen() {
  useScreenTitle('family availability')
  const family = useFamily()
  const familyId = family.data?.id
  const list = useFamilyAvailability(familyId)
  const tree = useFamilyTree(familyId)
  const settings = useAvailabilitySettings()
  const me = tree.data?.me ?? tree.data?.people.find((p) => p.relation === 'you')?.id
  const relation = new Map((tree.data?.people ?? []).map((p) => [p.id, p.relation ?? p.relation_label]))

  const people = list.data ?? []
  const relatives = people.filter((p) => p.person_id !== me)
  const sharingOff = settings.data && !settings.data.sharing_enabled

  let body
  if (family.isPending || (familyId && (list.isPending || tree.isPending))) body = <Loading label="checking who's free…" />
  else if (family.isError) body = <ErrorState message={family.error.message} onRetry={() => family.refetch()} />
  else if (!familyId)
    body = (
      <EmptyState title="no family yet" action={<Button to="/family">open family tree</Button>}>
        start or join a family to see when relatives are free.
      </EmptyState>
    )
  else if (list.isError) body = <ErrorState message={list.error.message} onRetry={() => list.refetch()} />
  else if (relatives.length === 0)
    body = (
      <EmptyState title="no relatives here yet" action={<Button tone="secondary" to="/family">invite from the family tree</Button>}>
        when relatives join your family, you'll see if they're free to talk.
      </EmptyState>
    )
  else
    body = (
      <ul className="flex flex-col gap-3">
        {relatives.map((p) => {
          const label = relation.get(p.person_id)
          return (
            <li key={p.person_id}>
              <Link
                to={`/availability/person/${p.person_id}`}
                className="hand-box flex min-h-20 items-center gap-3 border-2 border-ink p-3 transition-colors hover:bg-ink/5"
              >
                <Avatar name={p.display_name} src={p.avatar_url} />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-hand text-[1.6rem] leading-tight break-words">
                    {p.display_name}
                    {label && label !== p.display_name && <span className="text-muted"> · {label}</span>}
                  </span>
                  <span className="flex items-center gap-2 font-sans text-[1.2rem] leading-none">
                    <StatusDot status={p.status} />
                    {STATUS[p.status].short}
                  </span>
                </span>
                <ChevronRight className="size-6 shrink-0" strokeWidth={2.2} aria-hidden />
              </Link>
            </li>
          )
        })}
      </ul>
    )

  return (
    <ScreenBody screen="family-availability">
      <Header title="family availability" back="/" />
      {sharingOff && (
        <Notice className="mb-4">
          your availability is private, so relatives see you as "not shared".{' '}
          <Link to="/availability/me" className="underline underline-offset-4">
            change this
          </Link>
        </Notice>
      )}
      <div className="flex-1">{body}</div>
      <div className="mt-6">
        <Button to="/availability/me">my schedule</Button>
      </div>
    </ScreenBody>
  )
}
