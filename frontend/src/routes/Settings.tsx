import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { BigButton, ScreenHeader } from '@/components/ui/Screen'
import { BottomNav } from '@/components/ui/Nav'
import { api } from '@/lib/api'
import { useDisplayMode, type DisplayMode } from '@/lib/displayMode'
import { supabase } from '@/lib/supabase'

/** Brief §5: Settings → Display mode. Anyone can change anytime. */
export function Settings() {
  const { mode, setMode } = useDisplayMode()
  const [age, setAge] = useState('')
  const [saved, setSaved] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    api.GET('/api/profile').then(({ data }) => {
      if (data && typeof data.age === 'number') setAge(String(data.age))
    }).catch(() => {})
  }, [])

  async function pick(m: DisplayMode) {
    setMode(m)
    try {
      await api.PATCH('/api/profile', { body: { ui_mode: m } })
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch {
      /* local only */
    }
  }

  async function saveAge() {
    const n = Number(age)
    if (!Number.isFinite(n)) return
    try {
      await api.PATCH('/api/profile', { body: { age: n } })
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch {
      /* ignore */
    }
  }

  async function signOut() {
    await supabase.auth.signOut()
    navigate('/')
  }

  const modes: Array<{ id: DisplayMode; label: string; hint: string }> = [
    { id: 'regular', label: 'Regular', hint: 'Full navigation (under 18 default)' },
    { id: 'simplified', label: 'Simplified', hint: 'Fewer actions, clear labels' },
    { id: 'extra_simple', label: 'Extra simple', hint: 'Large text, one thing at a time' },
  ]

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-8">
      <ScreenHeader title="Settings" />
      <h2 className="font-serif text-2xl">Display mode</h2>
      {modes.map((m) => (
        <button
          key={m.id}
          onClick={() => pick(m.id)}
          className={`rounded-xl border px-4 py-4 text-left ${
            mode === m.id ? 'border-ink bg-white' : 'border-ink/20 bg-white/60'
          }`}
        >
          <p className="text-lg">
            {m.label} {mode === m.id && '✓'}
          </p>
          <p className="text-sm text-muted">{m.hint}</p>
        </button>
      ))}
      <h2 className="mt-4 font-serif text-2xl">Age</h2>
      <div className="flex gap-2">
        <input
          value={age}
          onChange={(e) => setAge(e.target.value)}
          type="number"
          placeholder="Age"
          className="flex-1 rounded-lg border border-ink/20 bg-white px-3 py-2"
        />
        <button onClick={saveAge} className="rounded-lg bg-ink px-4 text-paper">
          Save
        </button>
      </div>
      {saved && <p className="text-sm text-muted">Saved.</p>}
      <div className="mt-4">
        <BigButton to="/onboarding">Retake setup</BigButton>
      </div>
      <button onClick={signOut} className="mt-2 text-sm text-muted underline">
        Sign out
      </button>
      <BottomNav />
    </main>
  )
}
