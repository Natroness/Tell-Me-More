import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { ScreenHeader } from '@/components/ui/Screen'
import { api } from '@/lib/api'
import { useFamily } from '@/lib/family'

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-900',
  in_progress: 'bg-blue-100 text-blue-900',
  completed: 'bg-green-100 text-green-900',
  declined: 'bg-red-100 text-red-900',
  cancelled: 'bg-gray-200 text-gray-700',
}

/** Brief §3: My requests — pending + completed; decline → choose another. */
export function MyRequests() {
  const { data: family } = useFamily()
  const [scope, setScope] = useState<'mine' | 'incoming'>('mine')
  const list = useQuery({
    queryKey: ['requests', family?.id, scope],
    enabled: !!family,
    queryFn: async () =>
      (await api.GET('/api/requests', {
        params: { query: { family_id: family!.id, scope } },
      })).data ?? [],
  })

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-8">
      <ScreenHeader title="My requests" />
      <div className="flex gap-2">
        {(['mine', 'incoming'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setScope(s)}
            className={`rounded-lg px-4 py-2 ${scope === s ? 'bg-ink text-paper' : 'border border-ink/20 bg-white'}`}
          >
            {s === 'mine' ? 'Sent' : 'For me'}
          </button>
        ))}
      </div>
      {(list.data ?? []).length === 0 && (
        <p className="text-muted">
          {list.isLoading ? 'Loading…' : 'No requests here yet.'}
        </p>
      )}
      {(list.data ?? []).map((r) => (
        <Link
          key={r.id}
          to={`/requests/${r.id}`}
          className="rounded-xl bg-white p-4 shadow"
        >
          <p className="font-medium">{r.message || 'Story request'}</p>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted">
            <span className={`rounded-full px-2 py-0.5 ${STATUS_STYLE[r.status] ?? ''}`}>
              {r.status.replace('_', ' ')}
            </span>
          </p>
          {scope === 'mine' && r.status === 'declined' && (
            <p className="mt-1 text-sm text-muted">They couldn&apos;t help — choose another relative.</p>
          )}
        </Link>
      ))}
    </main>
  )
}
