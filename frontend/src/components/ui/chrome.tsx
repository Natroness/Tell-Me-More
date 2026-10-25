import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, Outlet, useNavigate } from 'react-router'
import { ArrowLeft, BookOpen, Camera, ChevronDown, Pause, Play, Sparkles, User } from 'lucide-react'
import { useDisplayMode } from '@/lib/displayMode'
import { readReturnTo } from '@/lib/returnTo'
import { cn } from '@/lib/utils'

/** Phone-width column, centered on desktop, growing and scrolling with the page. */
export function FrameLayout() {
  return (
    <div className="flex min-h-dvh flex-1 justify-center bg-stage">
      <div className="flex min-h-dvh w-full max-w-[390px] flex-col bg-paper text-ink">
        <Outlet />
      </div>
    </div>
  )
}

/** Forced-white screen that ignores the dark theme (welcome and sign-up only). */
export function PaperScreen({
  children,
  className,
  screen,
}: {
  children: ReactNode
  className?: string
  screen?: string
}) {
  return (
    <div className="fixed inset-0 z-10 overflow-y-auto bg-[#fff] text-black">
      <main
        data-screen={screen}
        className={cn(
          'mx-auto flex min-h-full w-full max-w-[390px] flex-col px-7 pt-[max(3rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]',
          className,
        )}
      >
        {children}
      </main>
    </div>
  )
}

export function ScreenBody({
  children,
  className,
  screen,
}: {
  children: ReactNode
  className?: string
  screen?: string
}) {
  return (
    <main
      data-screen={screen}
      className={cn(
        'flex min-h-dvh flex-1 flex-col px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))]',
        className,
      )}
    >
      {children}
    </main>
  )
}

/**
 * Back arrow, centered title, optional action on the right.
 * `back` is a path, or omitted to go back in history (home when there is none).
 */
export function Header({
  title,
  back,
  right,
  className,
}: {
  title: ReactNode
  back?: string | false
  right?: ReactNode
  className?: string
}) {
  const navigate = useNavigate()
  const { mode } = useDisplayMode()
  const arrow = <ArrowLeft className="size-7" strokeWidth={2.2} />
  const backCls = 'grid size-12 place-items-center rounded-full'
  return (
    <header className={cn('mb-5 grid grid-cols-[3rem_1fr_3rem] items-center gap-1', className)}>
      <div className="-ml-3">
        {back === false ? null : back ? (
          <Link to={back} aria-label="Back" className={backCls}>
            {arrow}
          </Link>
        ) : (
          <button
            type="button"
            aria-label="Back"
            className={backCls}
            onClick={() => ((window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate('/'))}
          >
            {arrow}
          </button>
        )}
      </div>
      <h1
        className={cn(
          'text-center font-hand leading-[1.05] break-words',
          mode === 'extra_simple' ? 'text-[2.4rem]' : 'text-[2.1rem]',
        )}
      >
        {title}
      </h1>
      <div className="-mr-3 flex justify-end">{right}</div>
    </header>
  )
}

export function BootScreen() {
  return (
    <div className="grid min-h-dvh flex-1 place-items-center" role="status">
      <p className="font-hand text-5xl leading-none">tell me more</p>
    </div>
  )
}

export function BackLink({ to, state }: { to: string; state?: unknown }) {
  return (
    <Link to={to} state={state} aria-label="Back" className="-ml-3 grid size-12 place-items-center">
      <ArrowLeft className="size-7" strokeWidth={2.2} />
    </Link>
  )
}

type Tone = 'primary' | 'secondary'

export function buttonClass(tone: Tone = 'primary', big = false) {
  return cn(
    'hand-pill flex w-full items-center justify-center gap-2 border-2 border-ink px-6 text-center font-sans leading-none transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50',
    big ? 'min-h-[4.5rem] py-4 text-[2rem]' : 'min-h-16 py-3 text-[1.75rem]',
    tone === 'primary' ? 'bg-sun text-black' : 'bg-paper text-ink',
  )
}

/** Same look as the welcome buttons; not themed, so it stays white in dark mode. */
export const paperButton =
  'hand-pill flex min-h-16 w-full items-center justify-center border-2 border-black font-["Patrick_Hand",cursive] text-[1.9rem] leading-none text-black transition active:translate-y-px disabled:opacity-50'

export function Button({
  children,
  tone = 'primary',
  to,
  state,
  onClick,
  type = 'button',
  disabled,
  className,
}: {
  children: ReactNode
  tone?: Tone
  to?: string
  state?: unknown
  onClick?: () => void
  type?: 'button' | 'submit'
  disabled?: boolean
  className?: string
}) {
  const { mode } = useDisplayMode()
  const cls = cn(buttonClass(tone, mode === 'extra_simple'), className)
  if (to && !disabled) {
    return (
      <Link to={to} state={state} className={cls}>
        {children}
      </Link>
    )
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={cls}>
      {children}
    </button>
  )
}

export function YellowButton(props: {
  children: ReactNode
  disabled?: boolean
  type?: 'button' | 'submit'
  onClick?: () => void
  to?: string
}) {
  return <Button {...props} tone="primary" />
}

/** Quiet text action under the main buttons. */
export function HandLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="block py-2 text-center font-sans text-[1.5rem] leading-none underline-offset-4 hover:underline">
      {children}
    </Link>
  )
}

export function TextButton({ onClick, children, disabled }: { onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="py-2 text-center font-sans text-[1.4rem] leading-none underline-offset-4 hover:underline disabled:opacity-50"
    >
      {children}
    </button>
  )
}

export function Card({
  children,
  className,
  tone = 'plain',
}: {
  children: ReactNode
  className?: string
  tone?: 'plain' | 'sun' | 'dashed'
}) {
  return (
    <div
      className={cn(
        'hand-box border-2 p-4',
        tone === 'dashed' ? 'border-dashed border-ink/60' : 'border-ink',
        tone === 'sun' && 'bg-sun text-black',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** Progressive disclosure: secondary detail stays one tap away. */
export function Disclosure({
  summary,
  children,
  defaultOpen,
  className,
}: {
  summary: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  className?: string
}) {
  return (
    <details open={defaultOpen} className={cn('group hand-box border-2 border-ink/25 px-4', className)}>
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 font-sans text-[1.35rem] [&::-webkit-details-marker]:hidden">
        <span>{summary}</span>
        <ChevronDown className="size-5 shrink-0 transition group-open:rotate-180" aria-hidden />
      </summary>
      <div className="pb-4 font-sans text-[1.15rem] leading-snug">{children}</div>
    </details>
  )
}

export function FormError({ children }: { children?: ReactNode }) {
  if (!children) return null
  return (
    <p role="alert" className="text-center font-sans text-[1.2rem] leading-snug text-ink">
      {children}
    </p>
  )
}

/** Inline status card. Errors stay visible and can carry a retry. */
export function Notice({
  tone = 'info',
  title,
  children,
  onRetry,
  className,
}: {
  tone?: 'info' | 'error' | 'success'
  title?: ReactNode
  children?: ReactNode
  onRetry?: () => void
  className?: string
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'hand-box border-2 px-4 py-3 font-sans text-[1.15rem] leading-snug',
        tone === 'error' ? 'border-ink' : tone === 'success' ? 'border-ink bg-sun text-black' : 'border-sun',
        className,
      )}
    >
      {title && <p className="font-hand text-[1.5rem] leading-tight">{title}</p>}
      {children && <div className={title ? 'mt-1' : undefined}>{children}</div>}
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-2 underline underline-offset-4">
          try again
        </button>
      )}
    </div>
  )
}

export function Loading({ label = 'one moment…', className }: { label?: ReactNode; className?: string }) {
  return (
    <div role="status" className={cn('flex flex-col items-center gap-4 py-10 text-center', className)}>
      <div className="flex gap-2" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-3.5 animate-bounce rounded-full border-2 border-ink bg-sun"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
      <p className="font-sans text-[1.35rem] leading-snug">{label}</p>
    </div>
  )
}

export function EmptyState({
  title,
  children,
  action,
  icon,
}: {
  title: ReactNode
  children?: ReactNode
  action?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      {icon}
      <p className="font-hand text-[1.8rem] leading-tight">{title}</p>
      {children && <div className="font-sans text-[1.2rem] leading-snug text-muted">{children}</div>}
      {action && <div className="mt-2 w-full">{action}</div>}
    </div>
  )
}

/** Load failure with a retry, in the same design system. */
export function ErrorState({ message, onRetry }: { message?: ReactNode; onRetry?: () => void }) {
  return (
    <Notice tone="error" title="that didn't load" onRetry={onRetry}>
      {message ?? 'check your connection and try again.'}
    </Notice>
  )
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string; count?: number }[]
  value: T
  onChange: (id: T) => void
}) {
  return (
    <div role="tablist" className="mb-4 flex gap-6 border-b-2 border-ink/15">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            '-mb-0.5 min-h-12 border-b-4 px-1 font-sans text-[1.4rem]',
            value === t.id ? 'border-sun' : 'border-transparent text-muted',
          )}
        >
          {t.label}
          {t.count ? ` (${t.count})` : ''}
        </button>
      ))}
    </div>
  )
}

export function Chip({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'sun' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border-[1.5px] border-ink px-3 py-0.5 font-sans text-[1rem] leading-snug',
        tone === 'sun' && 'border-ink bg-sun text-black',
      )}
    >
      {children}
    </span>
  )
}

export type Provenance = 'memory' | 'observation' | 'history' | 'inference'

const SOURCE: Record<Provenance, { label: string; icon: ReactNode; cls: string }> = {
  memory: { label: 'family memory', icon: <User className="size-3.5" />, cls: 'border-ink bg-sun text-black' },
  observation: { label: 'seen in the photo', icon: <Camera className="size-3.5" />, cls: 'border-ink' },
  history: { label: 'history', icon: <BookOpen className="size-3.5" />, cls: 'border-ink' },
  inference: { label: 'ai suggestion', icon: <Sparkles className="size-3.5" />, cls: 'border-dashed border-ink/70 text-muted' },
}

/** Keeps family words, AI guesses, and checked history visibly apart. */
export function SourceTag({ kind }: { kind: Provenance }) {
  const s = SOURCE[kind]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border-[1.5px] px-2.5 py-0.5 font-sans text-[0.95rem] leading-snug',
        s.cls,
      )}
    >
      {s.icon}
      {s.label}
    </span>
  )
}

export function Avatar({
  name,
  src,
  size = 'md',
  highlight,
}: {
  name?: string | null
  src?: string | null
  size?: 'sm' | 'md' | 'lg'
  highlight?: boolean
}) {
  const dim = size === 'sm' ? 'size-10 text-lg' : size === 'lg' ? 'size-24 text-4xl' : 'size-14 text-2xl'
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center overflow-hidden rounded-full border-2 font-hand',
        highlight ? 'border-sun ring-2 ring-sun' : 'border-ink',
        dim,
      )}
      aria-hidden
    >
      {src ? (
        <img src={src} alt="" className="size-full object-cover" />
      ) : name ? (
        name.trim().charAt(0).toLowerCase()
      ) : (
        <User className="size-1/2" />
      )}
    </span>
  )
}

function fmt(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const BARS = [3, 6, 4, 8, 5, 9, 6, 4, 7, 10, 6, 8, 4, 6, 9, 5, 7, 4, 8, 6, 3, 7, 5, 8, 4, 6]

/** Round play button, doodle waveform, and time — the mockup's audio row. */
export function AudioPlayer({
  src,
  durationMs,
  label = 'play recording',
  startMs,
}: {
  src: string
  durationMs?: number | null
  label?: string
  startMs?: number
}) {
  const ref = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const [dur, setDur] = useState(durationMs ?? 0)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const a = ref.current
    if (a && startMs != null) a.currentTime = startMs / 1000
  }, [src, startMs])

  function toggle() {
    const a = ref.current
    if (!a) return
    if (a.paused) a.play().catch(() => setFailed(true))
    else a.pause()
  }

  const progress = dur > 0 ? pos / dur : 0
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pause' : label}
        className="grid size-12 shrink-0 place-items-center rounded-full border-2 border-ink bg-ink text-paper"
      >
        {playing ? <Pause className="size-5" fill="currentColor" /> : <Play className="ml-0.5 size-5" fill="currentColor" />}
      </button>
      <div className="flex h-10 min-w-0 flex-1 items-center gap-[3px]" aria-hidden>
        {BARS.map((h, i) => (
          <span
            key={i}
            className={cn('w-[3px] flex-1 rounded-full', i / BARS.length < progress ? 'bg-ink' : 'bg-sun')}
            style={{ height: `${h * 9}%` }}
          />
        ))}
      </div>
      <span className="shrink-0 font-sans text-[1.05rem] tabular-nums">{failed ? 'unavailable' : fmt(playing || pos ? pos : dur)}</span>
      <audio
        ref={ref}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setFailed(true)}
        onTimeUpdate={(e) => setPos(e.currentTarget.currentTime * 1000)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration
          if (Number.isFinite(d)) setDur(d * 1000)
        }}
      />
    </div>
  )
}

/** Shown on the signed-out screens while an invitation link is waiting to reopen. */
export function InviteNote({ className }: { className?: string }) {
  if (!readReturnTo()) return null
  return (
    <p
      className={cn('hand-box border-2 border-sun px-4 py-2.5 text-left font-sans text-[1.1rem] leading-snug', className)}
      data-testid="invite-note"
    >
      you have a family invitation. sign in or create an account with the email it was sent to.
    </p>
  )
}

export function PersonMark() {
  return <Avatar size="lg" />
}
