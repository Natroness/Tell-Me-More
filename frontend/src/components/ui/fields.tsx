import { useId, useState } from 'react'
import { Eye, EyeOff, type LucideIcon } from 'lucide-react'
import { LANGUAGES, type LanguageId } from '@/lib/language'

const controlClass =
  'hand-box h-14 w-full border-[1.5px] border-ink/40 bg-paper px-4 font-sans text-[1.3rem] text-ink outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-sun'

export function TextField({
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
  name,
  inputMode,
  readOnly,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'email'
  autoComplete?: string
  name?: string
  inputMode?: 'text' | 'email'
  readOnly?: boolean
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-sans text-[1.35rem] leading-none">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        readOnly={readOnly}
        inputMode={inputMode}
        autoComplete={autoComplete}
        autoCapitalize={type === 'email' ? 'none' : 'words'}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        className={`${controlClass} ${readOnly ? 'opacity-70' : ''}`}
      />
    </div>
  )
}

export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  name,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete?: string
  name?: string
}) {
  const id = useId()
  const [show, setShow] = useState(false)
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-sans text-[1.35rem] leading-none">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={show ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          className={`${controlClass} pr-14`}
        />
        <button
          type="button"
          aria-label={show ? 'Hide password' : 'Show password'}
          onClick={() => setShow((open) => !open)}
          className="absolute top-1/2 right-2 grid size-10 -translate-y-1/2 place-items-center rounded-full"
        >
          {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
        </button>
      </div>
    </div>
  )
}

/** Rounded input with a leading icon; the label doubles as the placeholder. */
export function IconField({
  label,
  icon: Icon,
  value,
  onChange,
  type = 'text',
  autoComplete,
  name,
  readOnly,
}: {
  label: string
  icon: LucideIcon
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'email' | 'password'
  autoComplete?: string
  name?: string
  readOnly?: boolean
}) {
  const [show, setShow] = useState(false)
  const secret = type === 'password'
  return (
    <div className="flex h-16 items-center gap-3 hand-box border-[1.5px] border-black/30 px-5 focus-within:border-black">
      <Icon className="size-6 shrink-0" strokeWidth={2.2} aria-hidden />
      <input
        name={name}
        type={secret && !show ? 'password' : type === 'email' ? 'email' : 'text'}
        aria-label={label}
        placeholder={label}
        value={value}
        readOnly={readOnly}
        inputMode={type === 'email' ? 'email' : undefined}
        autoComplete={autoComplete}
        autoCapitalize={type === 'text' ? 'words' : 'none'}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        className={`min-w-0 flex-1 bg-transparent font-["Patrick_Hand",cursive] text-[1.45rem] text-black outline-none placeholder:text-black/60 ${readOnly ? 'opacity-60' : ''}`}
      />
      {secret && (
        <button
          type="button"
          aria-label={show ? 'Hide password' : 'Show password'}
          onClick={() => setShow((open) => !open)}
          className="-mr-2 grid size-11 shrink-0 place-items-center"
        >
          {show ? <EyeOff className="size-6" /> : <Eye className="size-6" />}
        </button>
      )}
    </div>
  )
}

export function AgeSlider({ value, onChange }: { value: number; onChange: (age: number) => void }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-3">
      <label htmlFor={id} className="font-sans text-[1.35rem] leading-none">
        age {value}
      </label>
      <input
        id={id}
        className="age-slider"
        type="range"
        min={1}
        max={120}
        step={1}
        value={value}
        aria-valuemin={1}
        aria-valuemax={120}
        aria-valuenow={value}
        aria-valuetext={`${value} years`}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

export function LanguageSelect({
  value,
  onChange,
}: {
  value: LanguageId
  onChange: (id: LanguageId) => void
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-sans text-[1.35rem] leading-none">
        language
      </label>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value as LanguageId)}
          className={`${controlClass} appearance-none pr-12`}
        >
          {LANGUAGES.map((language) => (
            <option key={language.id} value={language.id}>
              {language.label}
            </option>
          ))}
        </select>
        <span aria-hidden className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 font-sans text-2xl">
          ▾
        </span>
      </div>
    </div>
  )
}
