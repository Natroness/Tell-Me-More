import { useId, type ReactNode } from 'react'
import { Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

const MIN_AGE = 1
const MAX_AGE = 120

/** Screen 03: "age 24" over a slider flanked by − and +. */
export function AgeStepper({ value, onChange }: { value: number; onChange: (age: number) => void }) {
  const id = useId()
  const step = (delta: number) => onChange(Math.min(MAX_AGE, Math.max(MIN_AGE, value + delta)))
  const btn = 'grid size-12 shrink-0 place-items-center rounded-full border-2 border-ink disabled:opacity-40'
  return (
    <div className="flex flex-col gap-3">
      <label htmlFor={id} className="text-center font-sans text-[1.6rem] leading-none">
        age {value}
      </label>
      <div className="flex items-center gap-3">
        <button type="button" aria-label="Younger" className={btn} onClick={() => step(-1)} disabled={value <= MIN_AGE}>
          <Minus className="size-6" strokeWidth={2.4} />
        </button>
        <input
          id={id}
          className="age-slider min-w-0 flex-1"
          type="range"
          min={MIN_AGE}
          max={MAX_AGE}
          step={1}
          value={value}
          aria-valuetext={`${value} years`}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <button type="button" aria-label="Older" className={btn} onClick={() => step(1)} disabled={value >= MAX_AGE}>
          <Plus className="size-6" strokeWidth={2.4} />
        </button>
      </div>
    </div>
  )
}

/** Pill row where one option is filled yellow (display mode, theme). */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { id: T; label: ReactNode }[]
  value: T
  onChange: (id: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            'hand-pill inline-flex min-h-12 flex-auto items-center justify-center gap-1.5 border-2 border-ink px-3 py-2 text-center font-sans text-[1.2rem] leading-none',
            value === o.id ? 'bg-sun text-black' : 'bg-paper text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="font-sans text-[1.35rem] leading-none">{children}</h2>
}
