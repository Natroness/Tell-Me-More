import type { Session } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { clearDevSession, readDevSession, type DevSession } from '@/lib/devAuth'
import { supabase, supabaseConfigured } from '@/lib/supabase'

type AuthValue = {
  ready: boolean
  session: Session | null
  /** Testing-only email-only session (no Supabase). Null in production use. */
  devSession: DevSession | null
  refreshDevSession: () => void
  signOut: () => Promise<void>
}

const AuthCtx = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const account = useRef<string | null | undefined>(undefined)
  const [session, setSession] = useState<Session | null | undefined>(
    supabaseConfigured ? undefined : null,
  )
  const [devSession, setDevSession] = useState<DevSession | null>(() => readDevSession())

  // A dev session counts as signed in when there is no Supabase session. It is
  // synthesized into a Session-shaped object so the rest of the app keeps working.
  const effectiveSession: Session | null | undefined =
    session ??
    (devSession
      ? ({
          access_token: devSession.access_token,
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: '',
          user: {
            id: devSession.user_id,
            email: devSession.email,
            aud: 'authenticated',
            role: 'authenticated',
          },
        } as unknown as Session)
      : null)

  useEffect(() => {
    function adopt(next: Session | null) {
      const nextAccount = next?.user.id ?? devSession?.user_id ?? null
      if (account.current !== undefined && account.current !== nextAccount) qc.clear()
      account.current = nextAccount
      setSession(next)
    }
    if (!supabaseConfigured) {
      adopt(null)
      return
    }
    let ignore = false
    let receivedEvent = false
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!ignore && !receivedEvent) adopt(data.session)
      })
      .catch(() => {
        if (!ignore && !receivedEvent) adopt(null)
      })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      receivedEvent = true
      adopt(next)
    })
    function onStorage(e: StorageEvent) {
      if (e.key === 'lorebook.dev-session') setDevSession(readDevSession())
    }
    window.addEventListener('storage', onStorage)
    return () => {
      ignore = true
      data.subscription.unsubscribe()
      window.removeEventListener('storage', onStorage)
    }
  }, [qc, devSession?.user_id])

  const signOut = useCallback(async () => {
    clearDevSession()
    setDevSession(null)
    if (supabaseConfigured) {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    }
    setSession(null)
  }, [])

  const refreshDevSession = useCallback(() => {
    setDevSession(readDevSession())
  }, [])

  return (
    <AuthCtx.Provider
      value={{
        ready: session !== undefined,
        session: effectiveSession ?? null,
        devSession,
        refreshDevSession,
        signOut,
      }}
    >
      {children}
    </AuthCtx.Provider>
  )
}

export function useAuth() {
  const value = useContext(AuthCtx)
  if (!value) throw new Error('useAuth must be used within AuthProvider')
  return value
}
