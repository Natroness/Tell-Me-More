import { useState } from 'react'
import { Button, EmptyState, ErrorState, Header, Loading, ScreenBody, Tabs } from '@/components/ui/chrome'
import { useFamily } from '@/lib/family'
import { useScreenTitle } from '@/lib/useScreenTitle'
import { useRequestBoard } from '@/routes/capture/data'
import { RequestCard } from '@/routes/capture/shared'

/** Requests you sent and requests waiting for you, in the hub's card style. */
export function MyRequests() {
  useScreenTitle('my requests')
  const { data: family } = useFamily()
  const [scope, setScope] = useState<'mine' | 'incoming'>('mine')
  const { sent, incoming, people, heirloomOf } = useRequestBoard(family?.id)
  const list = scope === 'mine' ? sent : incoming
  const waiting = (incoming.data ?? []).filter((r) => r.status === 'pending').length

  return (
    <ScreenBody screen="my-requests">
      <Header title="my requests" back="/stories" />
      <Tabs
        tabs={[
          { id: 'mine', label: 'sent' },
          { id: 'incoming', label: 'for me', count: waiting },
        ]}
        value={scope}
        onChange={setScope}
      />
      {!family || list.isLoading ? (
        <Loading label="loading requests…" />
      ) : list.isError ? (
        <ErrorState message={list.error.message} onRetry={() => list.refetch()} />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState
          title={scope === 'mine' ? "you haven't asked anyone yet" : 'nothing waiting for you'}
          action={scope === 'mine' ? <Button to="/capture">capture an object</Button> : undefined}
        >
          {scope === 'mine'
            ? 'photograph an object and ask a relative to tell its story.'
            : 'when someone asks you about an object, it shows up here.'}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          {(list.data ?? []).map((r) => (
            <RequestCard
              key={r.id}
              r={r}
              side={scope === 'mine' ? 'sent' : 'incoming'}
              heirloom={heirloomOf(r.heirloom_id)}
              name={people.nameOf(scope === 'mine' ? r.storyteller_id : r.listener_id)}
            />
          ))}
        </div>
      )}
    </ScreenBody>
  )
}
