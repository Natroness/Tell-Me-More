import type { Session } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import { Outlet } from 'react-router'
import { supabase } from '@/lib/supabase'

export function AuthGate() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (session === undefined) return null
  return session ? <Outlet /> : <SignIn />
}

function SignIn() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.href },
    })
    if (!error) setSent(true)
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4">
      <h1 className="font-serif text-4xl">Lorebook</h1>
      <p className="text-muted">Keep the stories behind the things your family keeps.</p>
      {sent ? (
        <p>Check your email for a sign-in link.</p>
      ) : (
        <form onSubmit={send} className="flex flex-col gap-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="rounded-lg border border-ink/20 bg-white px-4 py-3"
          />
          <button className="rounded-lg bg-ink px-4 py-3 text-paper">Send sign-in link</button>
        </form>
      )}
    </main>
  )
}
