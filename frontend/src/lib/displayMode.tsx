import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { supabase } from '@/lib/supabase'

export type DisplayMode = 'regular' | 'simplified' | 'extra_simple'

const KEY = 'tmm-ui-mode'

export function defaultModeForAge(age: number | null | undefined): DisplayMode {
  if (age == null) return 'simplified'
  if (age < 18) return 'regular'
  if (age <= 50) return 'simplified'
  return 'extra_simple'
}

const Ctx = createContext<{
  mode: DisplayMode
  age: number | null
  setMode: (m: DisplayMode) => void
  setAge: (a: number | null) => void
}>({ mode: 'simplified', age: null, setMode: () => {}, setAge: () => {} })

export function DisplayModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<DisplayMode>(() => {
    const saved = localStorage.getItem(KEY)
    return saved === 'regular' || saved === 'extra_simple' ? saved : 'simplified'
  })
  const [age, setAgeState] = useState<number | null>(null)

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!data.session) return
        return api.GET('/api/profile').then(({ data: p }) => {
          if (p?.ui_mode) {
            setModeState(p.ui_mode as DisplayMode)
            localStorage.setItem(KEY, p.ui_mode)
          }
          if (typeof p?.age === 'number') setAgeState(p.age)
        })
      })
      .catch(() => {})
  }, [])

  const setMode = useCallback((m: DisplayMode) => {
    setModeState(m)
    localStorage.setItem(KEY, m)
    api.PATCH('/api/profile', { body: { ui_mode: m } }).catch(() => {})
  }, [])

  const setAge = useCallback((a: number | null) => {
    setAgeState(a)
    if (a != null) {
      const m = defaultModeForAge(a)
      setModeState(m)
      localStorage.setItem(KEY, m)
    }
  }, [])

  return <Ctx.Provider value={{ mode, age, setMode, setAge }}>{children}</Ctx.Provider>
}

export function useDisplayMode() {
  return useContext(Ctx)
}

export function headingSize(mode: DisplayMode): string {
  if (mode === 'extra_simple') return 'text-4xl'
  if (mode === 'regular') return 'text-2xl'
  return 'text-3xl'
}
