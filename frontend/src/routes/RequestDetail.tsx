import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { Link } from 'react-router'
import { BigButton, ScreenHeader } from '@/components/ui/Screen'
import { api } from '@/lib/api'

/** Brief §4H: incoming request — object, message, Tell/Later/Don't know. */
export function RequestDetail() {
  const { requestId } = useParams() as { requestId: string }
  const qc = useQueryClient()
  const detail = useQuery({
    queryKey: ['request', requestId],
    queryFn: async () =>
      (await api.GET('/api/requests/{request_id}', {
        params: { path: { request_id: requestId } },
      })).data,
  })
  const act = useMutation({
    mutationFn: async (kind: 'accept' | 'decline' | 'cancel') => {
      const path = { request_id: requestId }
      if (kind === 'accept')
        return (await api.POST('/api/requests/{request_id}/accept', { params: { path } })).data
      if (kind === 'decline')
        return (await api.POST('/api/requests/{request_id}/decline', { params: { path } })).data
      return (await api.POST('/api/requests/{request_id}/cancel', { params: { path } })).data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['request', requestId] })
      qc.invalidateQueries({ queryKey: ['requests'] })
    },
  })

  const r = detail.data
  if (!r) return <main className="mx-auto max-w-xl px-4 py-8">Loading…</main>

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-8">
      <ScreenHeader title="Request" />
      <p className="text-lg">
        {r.listener_name} wants to hear about {r.storyteller_name}&apos;s{' '}
        {r.heirloom_title ?? 'object'}
      </p>
      {r.heirloom_cover_url && <img src={r.heirloom_cover_url} className="rounded-xl" />}
      {r.capture_url && <img src={r.capture_url} className="rounded-xl" />}
      {r.message && <p className="rounded-xl bg-white p-4 shadow">“{r.message}”</p>}
      <p className="text-sm text-muted">Status: {r.status.replace('_', ' ')}</p>
      {r.status === 'pending' && (
        <>
          <BigButton
            onClick={() => act.mutate('accept')}
            disabled={act.isPending}
            primary
          >
            Tell the story
          </BigButton>
          <BigButton to={`/answer/${r.id}`}>Record now</BigButton>
          <button
            onClick={() => act.mutate('decline')}
            disabled={act.isPending}
            className="text-sm text-muted underline"
          >
            I don&apos;t know this story
          </button>
        </>
      )}
      {r.status === 'in_progress' && (
        <BigButton to={`/answer/${r.id}`} primary>
          Continue recording
        </BigButton>
      )}
      {act.isError && <p className="text-red-700">That didn&apos;t work. Try again.</p>}
      <Link to="/requests" className="text-sm text-muted underline">
        Back to requests
      </Link>
    </main>
  )
}
