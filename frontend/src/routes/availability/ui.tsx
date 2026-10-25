import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { browserTimeZone, controlClass, timeZones, zoneLabel, type Status } from './data'

export function StatusDot({ status, className }: { status: Status; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-3.5 shrink-0 rounded-full border-2 border-ink',
        status === 'free_now' && 'bg-sun',
        status === 'busy_now' && 'bg-ink',
        className,
      )}
    />
  )
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: ReactNode
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div className="flex min-h-12 items-center justify-between gap-3">
      <label htmlFor={id} className="font-sans text-[1.3rem] leading-snug break-words">
        {label}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-9 w-16 shrink-0 rounded-full border-2 border-ink transition disabled:opacity-50',
          checked ? 'bg-sun' : 'bg-paper',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'absolute top-1/2 size-6 -translate-y-1/2 rounded-full border-2 border-ink bg-paper transition-all',
            checked ? 'left-[calc(100%-1.75rem)]' : 'left-1',
          )}
        />
      </button>
    </div>
  )
}

export function Field({ label, children, hint }: { label: ReactNode; children: (id: string) => ReactNode; hint?: ReactNode }) {
  const id = useId()
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="font-sans text-[1.3rem] leading-none">
        {label}
      </label>
      {children(id)}
      {hint && <p className="font-sans text-[1.05rem] leading-snug text-muted">{hint}</p>}
    </div>
  )
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  disabled,
  hint,
}: {
  label: ReactNode
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  disabled?: boolean
  hint?: ReactNode
}) {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <div className="relative">
          <select
            id={id}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className={cn(controlClass, 'appearance-none truncate pr-12')}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span aria-hidden className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 font-sans text-2xl">
            ▾
          </span>
        </div>
      )}
    </Field>
  )
}

export function TimeZoneSelect({
  label = 'time zone',
  value,
  onChange,
  disabled,
  hint,
}: {
  label?: string
  value: string
  onChange: (zone: string) => void
  disabled?: boolean
  hint?: ReactNode
}) {
  const browser = browserTimeZone()
  return (
    <SelectField
      label={label}
      value={value}
      onChange={onChange}
      disabled={disabled}
      hint={hint}
      options={timeZones(value, browser).map((z) => ({
        value: z,
        label: z === browser ? `${zoneLabel(z)} (this device)` : zoneLabel(z),
      }))}
    />
  )
}
