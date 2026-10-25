import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { BottomNav } from '@/components/ui/Nav'
import { ScreenHeader } from '@/components/ui/Screen'
import { api } from '@/lib/api'

/** Brief §4H + §7: in-app notifications when push is off. */
export function Notifications() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const list = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => (await api.GET('/api/notifications')).data ?? [],
    refetchInterval: 15000,
  })
  const read = useMutation({
    mutationFn: async (id: string) =>
      (await api.POST('/api/notifications/{notification_id}/read', {
        params: { path: { notification_id: id } },
      })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  async function open(n: { id: string; type: string; request_id?: string | null; heirloom_id?: string | null }) {
    try {
      await read.mutateAsync(n.id)
    } catch {
      /* ignore */
    }
    if (n.type === 'storytime_ready' && n.heirloom_id) navigate(`/h/${n.heirloom_id}`)
    else if (n.request_id) navigate(`/requests/${n.request_id}`)
  }

  const label: Record<string, string> = {
    request_received: 'Someone wants to hear your story',
    request_declined: 'A storyteller could not help',
    story_ready: 'A story is ready',
    storytime_ready: 'A Storytime video is ready',
    memory_added: 'Someone added a memory',
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-3 px-4 py-8">
      <ScreenHeader title="Notifications" />
      {(list.data ?? []).length === 0 && (
        <p className="text-muted">{list.isLoading ? 'Loading…' : 'No notifications yet.'}</p>
      )}
      {(list.data ?? []).map((n) => (
        <button
          key={n.id}
          onClick={() => open(n)}
          className={`rounded-xl p-4 text-left shadow ${n.read_at ? 'bg-white/70' : 'bg-white'}`}
        >
          <p className="font-medium">{label[n.type] ?? n.type}</p>
          {!n.read_at && <p className="text-sm text-muted">New</p>}
        </button>
      ))}
      <BottomNav />
    </main>
  )
}
