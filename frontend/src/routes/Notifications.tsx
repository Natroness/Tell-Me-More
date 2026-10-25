import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import {
  BellOff,
  BookOpen,
  CircleSlash,
  Clapperboard,
  Images,
  Mail,
  MessageCircleQuestion,
  UserCheck,
  UserX,
  type LucideIcon,
} from 'lucide-react'
import { EmptyState, ErrorState, FormError, Header, Loading, ScreenBody } from '@/components/ui/chrome'
import { api, type Schemas } from '@/lib/api'
import { formatApiError } from '@/lib/apiError'
import { useScreenTitle } from '@/lib/useScreenTitle'
import { cn } from '@/lib/utils'

type Note = Schemas['Notification']

const ICON: Record<Note['type'], LucideIcon> = {
  request_received: MessageCircleQuestion,
  request_declined: CircleSlash,
  story_ready: BookOpen,
  storytime_ready: Clapperboard,
  memory_added: Images,
  invite_received: Mail,
  invite_accepted: UserCheck,
  invite_declined: UserX,
}

function destination(n: Note): string | null {
  switch (n.destination_type) {
    case 'story_request':
      return `/requests/${n.destination_id}`
    case 'story':
      return `/h/${n.destination_id}`
    case 'invitation':
    case 'invitation_status':
      return `/invite/${n.destination_id}`
    case 'family_tree':
      return '/family'
    case 'family_memory':
      return `/memories/${n.destination_id}`
    default:
      return null
  }
}

/** The server writes sentences like "Grandpa wants to hear about the watch."; match the app's lowercase voice. */
function softCase(message: string) {
  return message.charAt(0).toLowerCase() + message.slice(1)
}

function relativeTime(iso: string, now = Date.now()) {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000)
  if (!Number.isFinite(seconds)) return ''
  if (seconds < 60) return 'just now'
  const units: [number, string][] = [
    [60, 'minute'],
    [3600, 'hour'],
    [86400, 'day'],
    [604800, 'week'],
  ]
  if (seconds < 2592000) {
    const [size, unit] = [...units].reverse().find(([s]) => seconds >= s)!
    const n = Math.floor(seconds / size)
    return `${n} ${unit}${n === 1 ? '' : 's'} ago`
  }
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).toLowerCase()
}

export function Notifications() {
  useScreenTitle('notifications')
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [opening, setOpening] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const list = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      const { data, error: apiError } = await api.GET('/api/notifications')
      if (apiError || !data) throw new Error(formatApiError(apiError, 'we could not load your notifications.'))
      return data
    },
    refetchInterval: 15_000,
  })

  async function open(n: Note) {
    setError(null)
    const to = destination(n)
    if (!n.read_at) {
      setOpening(n.id)
      const { error: apiError } = await api.POST('/api/notifications/{notification_id}/read', {
        params: { path: { notification_id: n.id } },
      })
      setOpening(null)
      qc.invalidateQueries({ queryKey: ['notifications'] })
      if (n.type === 'memory_added') qc.invalidateQueries({ queryKey: ['memories'] })
      if (apiError && !to) {
        setError(formatApiError(apiError, 'we could not mark that as read. try again.'))
        return
      }
    }
    if (to) navigate(to)
  }

  return (
    <ScreenBody screen="notifications">
      <Header title="notifications" back="/" />
      {list.isLoading && <Loading label="checking for news…" />}
      {list.isError && <ErrorState message={list.error.message} onRetry={() => list.refetch()} />}
      {list.data && list.data.length === 0 && (
        <EmptyState
          icon={<BellOff className="size-12" strokeWidth={2} aria-hidden />}
          title="nothing new yet"
        >
          stories, invitations, and family memories will show up here.
        </EmptyState>
      )}
      <FormError>{error}</FormError>
      {list.data && list.data.length > 0 && (
        <ul className="flex flex-col gap-3">
          {list.data.map((n) => {
            const Icon = ICON[n.type] ?? Mail
            const unread = !n.read_at
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => open(n)}
                  disabled={opening === n.id}
                  className={cn(
                    'hand-box flex w-full items-center gap-3 border-2 px-4 py-3 text-left disabled:opacity-60',
                    unread ? 'border-ink' : 'border-ink/30',
                  )}
                >
                  <Icon className="size-9 shrink-0" strokeWidth={2} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block font-sans text-[1.2rem] leading-snug break-words">{softCase(n.message)}</span>
                    <span className="mt-0.5 block font-sans text-[1rem] leading-snug text-muted">
                      {relativeTime(n.created_at)}
                    </span>
                  </span>
                  {unread && (
                    <span className="size-3.5 shrink-0 rounded-full border-2 border-ink bg-sun">
                      <span className="sr-only">unread</span>
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </ScreenBody>
  )
}
