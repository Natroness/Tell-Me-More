import type { Session } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase, supabaseConfigured } from '@/lib/supabase'

type AuthValue = {
  ready: boolean
  session: Session | null
  signOut: () => Promise<void>
}

const AuthCtx = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const account = useRef<string | null | undefined>(undefined)
  const [session, setSession] = useState<Session | null | undefined>(
    supabaseConfigured ? undefined : null,
  )

  useEffect(() => {
    if (!supabaseConfigured) return
    let ignore = false
    let receivedEvent = false
    function adopt(next: Session | null) {
      if (ignore) return
      const nextAccount = next?.user.id ?? null
      if (account.current !== undefined && account.current !== nextAccount) qc.clear()
      account.current = nextAccount
      setSession(next)
    }
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!receivedEvent) adopt(data.session)
      })
      .catch(() => {
        if (!receivedEvent) adopt(null)
      })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      receivedEvent = true
      adopt(next)
    })
    return () => {
      ignore = true
      data.subscription.unsubscribe()
    }
  }, [qc])

  const signOut = useCallback(async () => {
    if (supabaseConfigured) {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    }
    setSession(null)
  }, [])

  return (
    <AuthCtx.Provider value={{ ready: session !== undefined, session: session ?? null, signOut }}>
      {children}
    </AuthCtx.Provider>
  )
}

export function useAuth() {
  const value = useContext(AuthCtx)
  if (!value) throw new Error('useAuth must be used within AuthProvider')
  return value
}
