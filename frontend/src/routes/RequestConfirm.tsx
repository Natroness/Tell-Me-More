import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { BigButton, ScreenHeader } from '@/components/ui/Screen'
import { api } from '@/lib/api'

/** Brief §3F: only after save; Back home / View request; stays pending. */
export function RequestConfirm() {
  const { requestId } = useParams() as { requestId: string }
  const detail = useQuery({
    queryKey: ['request', requestId],
    queryFn: async () =>
      (await api.GET('/api/requests/{request_id}', {
        params: { path: { request_id: requestId } },
      })).data,
  })
  const name = detail.data?.storyteller_name ?? 'them'

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 px-4">
      <ScreenHeader title="Sent" hideBack />
      <h1 className="font-serif text-3xl">Story requested</h1>
      <p className="text-lg text-muted">
        We&apos;ve asked {name} about this object. We&apos;ll let you know when the story is
        ready.
      </p>
      <p className="text-sm text-muted">The request stays pending until they respond.</p>
      <BigButton to="/" primary>
        Back to home
      </BigButton>
      <BigButton to={`/requests/${requestId}`}>View request</BigButton>
    </main>
  )
}
