import { Package } from 'lucide-react'
import { Link } from 'react-router'
import { Avatar, Chip } from '@/components/ui/chrome'
import { type Schemas } from '@/lib/api'
import { cn } from '@/lib/utils'
import { isOpen, statusWord } from './data'

export function ObjectThumb({ src, className }: { src?: string | null; className?: string }) {
  return (
    <span
      className={cn(
        'hand-box grid size-20 shrink-0 place-items-center overflow-hidden border-2 border-ink bg-paper',
        className,
      )}
      aria-hidden
    >
      {src ? (
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        <Package className="size-1/2" strokeWidth={2.2} />
      )}
    </span>
  )
}

/** One story request in the hub / my-requests list. */
export function RequestCard({
  r,
  side,
  heirloom,
  name,
}: {
  r: Schemas['StoryRequest']
  side: 'sent' | 'incoming'
  heirloom?: Schemas['Heirloom']
  name?: string
}) {
  const to = side === 'incoming' && r.status === 'in_progress' ? `/answer/${r.id}` : `/requests/${r.id}`
  const who = name ?? 'a relative'
  return (
    <Link
      to={to}
      className="hand-box flex gap-3 border-2 border-ink p-3 transition-colors hover:bg-ink/5"
    >
      <ObjectThumb src={heirloom?.cover_url} className="size-16" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-hand text-[1.45rem] leading-tight break-words">
          {heirloom?.title ?? 'an object'}
        </p>
        <p className="flex items-center gap-2 font-sans text-[1.1rem] leading-snug break-words">
          <Avatar name={name} size="sm" />
          <span className="min-w-0 break-words">
            {side === 'sent' ? `you asked ${who}` : `${who} asked you`}
          </span>
        </p>
        {r.message && (
          <p className="font-sans text-[1.1rem] leading-snug break-words text-muted">“{r.message}”</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={r.status === 'pending' && side === 'incoming' ? 'sun' : 'plain'}>
            {statusWord(r.status)}
          </Chip>
          {side === 'sent' && r.status === 'declined' && (
            <span className="font-sans text-[1rem] leading-snug text-muted">ask someone else</span>
          )}
          {side === 'incoming' && isOpen(r.status) && (
            <span className="font-sans text-[1rem] leading-snug">tell the story →</span>
          )}
        </div>
      </div>
    </Link>
  )
}
