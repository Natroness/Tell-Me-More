import { useState } from 'react'
import { useNavigate } from 'react-router'
import { BigButton, ScreenHeader } from '@/components/ui/Screen'
import { api } from '@/lib/api'
import { defaultModeForAge, useDisplayMode } from '@/lib/displayMode'

/** Brief §5: age slider + numeric/plus-minus alt, Use simpler screens offer. */
export function Onboarding() {
  const { setAge, setMode } = useDisplayMode()
  const [age, setAgeLocal] = useState(30)
  const [simpler, setSimpler] = useState(false)
  const [saving, setSaving] = useState(false)
  const navigate = useNavigate()

  async function save() {
    setSaving(true)
    const mode = simpler ? 'extra_simple' : defaultModeForAge(age)
    try {
      await api.PATCH('/api/profile', { body: { age, ui_mode: mode } })
    } catch {
      /* offline: local only */
    }
    setAge(age)
    setMode(mode)
    setSaving(false)
    navigate('/')
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4">
      <ScreenHeader title="About you" hideBack />
      <p className="font-serif text-3xl">How old are you?</p>
      <p className="text-muted">We use this to pick comfortable text sizes.</p>
      <p className="font-serif text-5xl">{age}</p>
      <input
        type="range"
        min={5}
        max={100}
        value={age}
        onChange={(e) => setAgeLocal(Number(e.target.value))}
        className="w-full"
        aria-label="Age"
      />
      <div className="flex items-center gap-3">
        <button
          onClick={() => setAgeLocal(Math.max(5, age - 1))}
          className="rounded-lg border border-ink/20 bg-white px-4 py-2"
        >
          −
        </button>
        <input
          type="number"
          min={5}
          max={100}
          value={age}
          onChange={(e) => setAgeLocal(Number(e.target.value))}
          className="flex-1 rounded-lg border border-ink/20 bg-white px-4 py-2"
        />
        <button
          onClick={() => setAgeLocal(Math.min(100, age + 1))}
          className="rounded-lg border border-ink/20 bg-white px-4 py-2"
        >
          +
        </button>
      </div>
      <label className="flex items-center gap-3 text-lg">
        <input
          type="checkbox"
          checked={simpler}
          onChange={(e) => setSimpler(e.target.checked)}
          className="size-6"
        />
        Use simpler screens
      </label>
      <BigButton onClick={save} disabled={saving} primary>
        {saving ? 'Saving…' : 'Continue'}
      </BigButton>
    </main>
  )
}
