import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Bell, CircleUserRound } from 'lucide-react'
import {
  AvailabilityIcon,
  CaptureIcon,
  DatesIcon,
  MemoriesIcon,
  TimelineIcon,
  TreeIcon,
} from '@/components/ui/sketchIcons'
import { ScreenBody } from '@/components/ui/chrome'
import { api } from '@/lib/api'
import { useDisplayMode } from '@/lib/displayMode'
import { useScreenTitle } from '@/lib/useScreenTitle'
import { cn } from '@/lib/utils'

const tiles = [
  { to: '/stories', label: 'capture an object', icon: CaptureIcon },
  { to: '/dates', label: 'important dates', icon: DatesIcon },
  { to: '/family', label: 'family tree', icon: TreeIcon },
  { to: '/memories', label: 'family memories', icon: MemoriesIcon },
  { to: '/availability', label: 'family availability', icon: AvailabilityIcon },
  { to: '/timeline', label: 'timeline', icon: TimelineIcon },
]

export function Home() {
  useScreenTitle('tell me more')
  const { mode } = useDisplayMode()
  const big = mode === 'extra_simple'
  const unread = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: async () => (await api.GET('/api/notifications/unread-count')).data?.count ?? 0,
    refetchInterval: 30_000,
  })
  const count = unread.data ?? 0
  const iconBtn = 'relative grid size-12 shrink-0 place-items-center rounded-full'

  return (
    <ScreenBody screen="home">
      <header className="flex items-center justify-between gap-2">
        <h1 className="font-hand text-[2.6rem] leading-none">tell me more</h1>
        <div className="-mr-2 flex items-center">
          <Link
            to="/notifications"
            aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
            className={iconBtn}
          >
            <Bell className="size-7" strokeWidth={2.2} />
            {count > 0 && (
              <span className="absolute top-1 right-1 grid min-w-5 place-items-center rounded-full border-2 border-ink bg-sun px-1 font-sans text-[0.85rem] leading-4 text-black">
                {count > 9 ? '9+' : count}
              </span>
            )}
          </Link>
          <Link to="/account" aria-label="Profile and preferences" className={iconBtn}>
            <CircleUserRound className="size-8" strokeWidth={2.2} />
          </Link>
        </div>
      </header>

      <nav className="mt-8 grid grid-cols-2 gap-3" aria-label="Home">
        {tiles.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="hand-box flex min-h-36 min-w-0 flex-col items-center justify-center gap-2 border-2 border-ink px-2 py-4 text-center transition-colors hover:bg-ink/5 active:bg-sun active:text-black"
          >
            <Icon />
            <span
              className={cn(
                'w-full font-sans leading-[1.05] break-words hyphens-auto',
                big ? 'text-[1.6rem]' : 'text-[1.35rem]',
              )}
            >
              {label}
            </span>
          </Link>
        ))}
      </nav>
    </ScreenBody>
  )
}
