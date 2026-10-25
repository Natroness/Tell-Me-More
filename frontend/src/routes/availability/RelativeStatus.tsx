import { useParams } from 'react-router'
import { Avatar, Button, EmptyState, ErrorState, Header, Loading, ScreenBody } from '@/components/ui/chrome'
import { useDisplayMode } from '@/lib/displayMode'
import { useFamily, useFamilyTree } from '@/lib/family'
import { useScreenTitle } from '@/lib/useScreenTitle'
import { cn } from '@/lib/utils'
import { STATUS, relativeTime, useFamilyAvailability } from './data'
import { StatusDot } from './ui'

const EXPLAIN = {
  free_now: 'a good time to call or ask about a story.',
  busy_now: 'try again a little later.',
  not_shared: "they haven't shared their availability.",
}

export function RelativeStatusScreen() {
  const { userId: personId } = useParams()
  const { mode } = useDisplayMode()
  const family = useFamily()
  const familyId = family.data?.id
  const list = useFamilyAvailability(familyId)
  const tree = useFamilyTree(familyId)
  const person = list.data?.find((p) => p.person_id === personId)
  const treePerson = tree.data?.people.find((p) => p.id === personId)
  const label = treePerson?.relation ?? treePerson?.relation_label
  const isMe = !!personId && (tree.data?.me === personId || treePerson?.relation === 'you')
  useScreenTitle(person?.display_name ?? 'availability')

  let body
  if (family.isPending || (familyId && list.isPending)) body = <Loading />
  else if (family.isError) body = <ErrorState message={family.error.message} onRetry={() => family.refetch()} />
  else if (list.isError) body = <ErrorState message={list.error.message} onRetry={() => list.refetch()} />
  else if (!person)
    body = <EmptyState title="we couldn't find them">they may have left the family.</EmptyState>
  else
    body = (
      <div className="flex flex-col items-center gap-3 pt-4 text-center">
        <Avatar name={person.display_name} src={person.avatar_url} size="lg" highlight={person.status === 'free_now'} />
        {(isMe || (label && label !== person.display_name)) && (
          <p className="font-sans text-[1.25rem] break-words text-muted">{isMe ? 'you' : label}</p>
        )}
        <p
          className={cn(
            'mt-4 flex items-center gap-3 font-hand leading-tight break-words',
            mode === 'extra_simple' ? 'text-[3rem]' : 'text-[2.6rem]',
          )}
          aria-live="polite"
        >
          <StatusDot status={person.status} className="size-5" />
          {STATUS[person.status].big}
        </p>
        <p className="font-sans text-[1.25rem] leading-snug">{EXPLAIN[person.status]}</p>
        <p className="font-sans text-[1.1rem] text-muted">
          updated {relativeTime(person.last_updated_at)}
          {list.isFetching && ' · checking…'}
        </p>
      </div>
    )

  return (
    <ScreenBody screen="relative-status">
      <Header title={person?.display_name ?? 'availability'} back="/availability" />
      <div className="flex-1">{body}</div>
      <div className="mt-8 flex flex-col gap-3">
        {isMe && <Button to="/availability/me">my schedule</Button>}
        <Button tone="secondary" to="/availability">
          back
        </Button>
      </div>
    </ScreenBody>
  )
}
