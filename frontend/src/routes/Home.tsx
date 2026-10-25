import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { BigButton, ScreenHeader } from '@/components/ui/Screen'
import { api } from '@/lib/api'
import { headingSize, useDisplayMode } from '@/lib/displayMode'
import { useFamily } from '@/lib/family'

/** Brief §3A: Discover heading, prominent camera, 4 destinations. */
export function Home() {
  const { mode } = useDisplayMode()
  const { data: family } = useFamily()
  const unread = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => (await api.GET('/api/notifications')).data ?? [],
  })
  const unreadCount = (unread.data ?? []).filter((n) => !n.read_at).length

  if (!family) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-4">
        <ScreenHeader title="Welcome" hideBack />
        <p className="text-muted">Create a family to start collecting stories.</p>
        <BigButton to="/stories" primary>
          Get started
        </BigButton>
        <BigButton to="/onboarding">Set up display mode</BigButton>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-4 px-4 py-8">
      <h1 className={`font-serif ${headingSize(mode)}`}>Discover an object&apos;s story</h1>
      <Link
        to="/capture"
        className={`block rounded-2xl bg-ink text-center text-paper ${
          mode === 'extra_simple' ? 'px-6 py-6 text-2xl' : 'px-6 py-5 text-xl'
        }`}
      >
        Open camera
      </Link>
      <div className="grid grid-cols-2 gap-3">
        <BigButton to="/stories">Family stories</BigButton>
        <BigButton to="/requests">My requests</BigButton>
        <BigButton to="/tell">Tell a story</BigButton>
        <BigButton to="/notifications">
          Notifications{unreadCount > 0 ? ` (${unreadCount})` : ''}
        </BigButton>
      </div>
      <div className="mt-2 flex justify-between text-sm text-muted">
        <Link to="/family" className="underline">
          Family
        </Link>
        <Link to="/settings" className="underline">
          Settings · Display mode
        </Link>
      </div>
    </main>
  )
}
