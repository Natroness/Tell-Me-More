import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { ArrowLeft, Lock, Mail } from 'lucide-react'
import { InviteNote, PaperScreen, paperButton } from '@/components/ui/chrome'
import { useScreenTitle } from '@/lib/useScreenTitle'
import { IconField } from '@/components/ui/fields'
import { friendlyAuthError, missingSupabaseConfig } from '@/lib/apiError'
import { useAuth } from '@/lib/auth'
import { supabase, supabaseConfigured } from '@/lib/supabase'

export function SignIn() {
  useScreenTitle('sign in')
  const navigate = useNavigate()
  const { session } = useAuth()
  const [email, setEmail] = useState(session?.user.email ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!email.includes('@')) {
      setError('add a valid email.')
      return
    }
    if (!password) {
      setError('add your password.')
      return
    }
    if (!supabaseConfigured) {
      setError(missingSupabaseConfig)
      return
    }
    setBusy(true)
    const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (authError) {
      setError(friendlyAuthError(authError.message))
      return
    }
    navigate('/', { replace: true })
  }

  return (
    <PaperScreen screen="sign-in">
      <header className="relative flex min-h-12 items-center justify-center">
        <Link to="/welcome" aria-label="Back" className="absolute left-0 -ml-2 grid size-12 place-items-center">
          <ArrowLeft className="size-7" strokeWidth={2.2} />
        </Link>
        <h1 className="font-['Schoolbell',cursive] text-[2.3rem] leading-none">sign in</h1>
      </header>
      <InviteNote className="mt-6 border-[#FFD43B]" />
      <form onSubmit={submit} className="mt-8 flex flex-col gap-5" noValidate>
        <IconField label="email" icon={Mail} name="email" type="email" autoComplete="email" value={email} onChange={setEmail} />
        <IconField
          label="password"
          icon={Lock}
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
        />
        <div className="mt-6 flex flex-col gap-3">
          {error && (
            <p role="alert" className="text-center font-['Patrick_Hand',cursive] text-[1.2rem] leading-snug text-black">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy} className={`${paperButton} bg-[#FFD43B]`}>
            {busy ? 'signing in…' : 'continue →'}
          </button>
          <Link
            to="/sign-up"
            className="block py-2 text-center font-['Patrick_Hand',cursive] text-[1.5rem] leading-none underline-offset-4 hover:underline"
          >
            create account
          </Link>
        </div>
      </form>
    </PaperScreen>
  )
}
