import { Package } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export const textareaClass =
  'hand-box w-full border-[1.5px] border-ink/40 bg-paper px-4 py-3 font-sans text-[1.25rem] leading-snug text-ink outline-none placeholder:text-muted focus:border-ink focus-visible:ring-2 focus-visible:ring-sun'

export function ObjectPhoto({ src, alt, className }: { src?: string | null; alt?: string; className?: string }) {
  return (
    <div className={cn('hand-box mx-auto aspect-square w-full overflow-hidden border-2 border-ink bg-paper', className)}>
      {src ? (
        <img src={src} alt={alt ?? 'the object'} className="size-full object-cover" />
      ) : (
        <div className="grid size-full place-items-center" aria-hidden>
          <Package className="size-1/3" strokeWidth={2.2} />
        </div>
      )}
    </div>
  )
}

export function Thumb({ src, className }: { src?: string | null; className?: string }) {
  return (
    <span
      className={cn('hand-box grid size-16 shrink-0 place-items-center overflow-hidden border-2 border-ink bg-paper', className)}
      aria-hidden
    >
      {src ? <img src={src} alt="" className="size-full object-cover" /> : <Package className="size-1/2" strokeWidth={2.2} />}
    </span>
  )
}

const BAR_COUNT = 28

/** Bars that follow the microphone level while recording; flat when idle or paused. */
export function LiveWaveform({ level, active }: { level?: () => number; active: boolean }) {
  const [bars, setBars] = useState<number[]>(() => Array(BAR_COUNT).fill(0))
  const frame = useRef(0)

  useEffect(() => {
    if (!active || !level) return
    let last = 0
    const tick = (t: number) => {
      if (t - last > 80) {
        last = t
        const v = Math.min(1, level() * 6)
        setBars((b) => [...b.slice(1), v])
      }
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame.current)
  }, [active, level])

  return (
    <div className="flex h-14 min-w-0 flex-1 items-center gap-[3px]" aria-hidden>
      {bars.map((v, i) => (
        <span
          key={i}
          className={cn('w-[3px] flex-1 rounded-full', active ? 'bg-sun' : 'bg-ink/25')}
          style={{ height: `${Math.max(8, v * 100)}%` }}
        />
      ))}
    </div>
  )
}
