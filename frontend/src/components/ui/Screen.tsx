import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { cn } from '@/lib/utils'
import { useDisplayMode } from '@/lib/displayMode'

export function ScreenHeader({
  title,
  hideBack,
}: {
  title: string
  hideBack?: boolean
}) {
  const navigate = useNavigate()
  const { mode } = useDisplayMode()
  return (
    <header className="mb-4 flex items-center gap-3">
      {!hideBack && (
        <button
          onClick={() => navigate(-1)}
          className="rounded-lg border border-ink/20 bg-white px-3 py-2 text-sm"
        >
          Back
        </button>
      )}
      <Link to="/" className="rounded-lg border border-ink/20 bg-white px-3 py-2 text-sm">
        Home
      </Link>
      <h1 className={cn('font-serif', mode === 'extra_simple' ? 'text-3xl' : 'text-xl')}>
        {title}
      </h1>
    </header>
  )
}

export function BigButton({
  to,
  onClick,
  disabled,
  children,
  primary,
}: {
  to?: string
  onClick?: () => void
  disabled?: boolean
  children: React.ReactNode
  primary?: boolean
}) {
  const { mode } = useDisplayMode()
  const cls = cn(
    'block w-full rounded-xl px-6 text-center',
    mode === 'extra_simple' ? 'py-5 text-xl' : 'py-4 text-lg',
    primary ? 'bg-ink text-paper' : 'border border-ink/20 bg-white',
    disabled && 'opacity-40',
  )
  if (to && !disabled) {
    return (
      <Link to={to} className={cls}>
        {children}
      </Link>
    )
  }
  return (
    <button onClick={onClick} disabled={disabled} className={cls}>
      {children}
    </button>
  )
}

export function ReadMore({ text, short = 140 }: { text: string; short?: number }) {
  const { mode } = useDisplayMode()
  const [open, setOpen] = useState(false)
  if (mode !== 'extra_simple' || text.length <= short) return <p>{text}</p>
  return (
    <div>
      <p>{open ? text : `${text.slice(0, short)}…`}</p>
      <button onClick={() => setOpen(!open)} className="text-sm text-muted underline">
        {open ? 'Show less' : 'Read more'}
      </button>
    </div>
  )
}

