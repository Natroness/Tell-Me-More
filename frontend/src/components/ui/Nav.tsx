import { Link, useLocation } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useDisplayMode } from '@/lib/displayMode'
import { cn } from '@/lib/utils'

const TABS = [
  { to: '/', label: 'Home' },
  { to: '/stories', label: 'Stories' },
  { to: '/requests', label: 'Requests' },
  { to: '/notifications', label: 'Alerts' },
  { to: '/family', label: 'Family' },
] as const

/** Persistent bottom tab bar for smooth navigation. Hidden on focused flow screens. */
export function BottomNav() {
  const { pathname } = useLocation()
  const { mode } = useDisplayMode()
  const unread = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => (await api.GET('/api/notifications')).data ?? [],
    refetchInterval: 30000,
  })
  const unreadCount = (unread.data ?? []).filter((n) => !n.read_at).length

  // Hide on capture/record/interview flows so the elder sees one action at a time.
  if (
    pathname.startsWith('/capture') ||
    pathname.startsWith('/review') ||
    pathname.startsWith('/archive') ||
    pathname.startsWith('/interview') ||
    pathname.startsWith('/answer')
  ) {
    return null
  }

  return (
    <nav
      aria-label="Main"
      className="sticky bottom-0 z-10 mt-8 border-t border-ink/10 bg-paper/95 backdrop-blur"
    >
      <div className="mx-auto grid max-w-xl grid-cols-5">
        {TABS.map((t) => {
          const active = t.to === '/' ? pathname === '/' : pathname.startsWith(t.to)
          const badge = t.to === '/notifications' && unreadCount > 0 ? ` (${unreadCount})` : ''
          return (
            <Link
              key={t.to}
              to={t.to}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'px-1 text-center',
                mode === 'extra_simple' ? 'py-4 text-base' : 'py-3 text-sm',
                active ? 'font-semibold text-ink' : 'text-muted',
              )}
            >
              {t.label}
              {badge}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

/** Small inline loading row. */
export function Loading({ text = 'Loading…' }: { text?: string }) {
  return (
    <p role="status" className="py-6 text-center text-muted">
      {text}
    </p>
  )
}

/** Friendly empty state with one action. */
export function EmptyState({ text, to, action }: { text: string; to: string; action: string }) {
  return (
    <div className="rounded-xl bg-white p-6 text-center shadow">
      <p className="text-muted">{text}</p>
      <Link to={to} className="mt-3 inline-block rounded-lg bg-ink px-4 py-2 text-paper">
        {action}
      </Link>
    </div>
  )
}

/** Short error with a clear next action. */
export function ErrorBanner({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl bg-red-50 p-4 text-sm text-red-900">
      <p>{text}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-1 underline">
          Try again
        </button>
      )}
    </div>
  )
}
