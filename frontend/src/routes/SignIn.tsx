import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { ArrowLeft, Lock, Mail } from 'lucide-react'
import { InviteNote, PaperScreen, paperButton } from '@/components/ui/chrome'
import { useScreenTitle } from '@/lib/useScreenTitle'
import { IconField } from '@/components/ui/fields'
import { friendlyAuthError, missingSupabaseConfig } from '@/lib/apiError'
import { useAuth } from '@/lib/auth'
import { sendSignInLink } from '@/lib/magicLink'
import { supabase, supabaseConfigured } from '@/lib/supabase'
import { DevLoginSection } from '@/components/DevLogin'

type Mode = 'password' | 'magic'

export function SignIn() {
  useScreenTitle('sign in')
  const navigate = useNavigate()
  const { session } = useAuth()
  const [email, setEmail] = useState(session?.user.email ?? '')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<Mode>('password')
  const [linkSent, setLinkSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function validEmail(value: string) {
    return value.includes('@')
  }

  async function submitPassword(e: FormEvent) {
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

  async function submitMagicLink(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!validEmail(email)) {
      setError('add a valid email.')
      return
    }
    if (!supabaseConfigured) {
      setError(missingSupabaseConfig)
      return
    }
    setBusy(true)
    const failure = await sendSignInLink(email)
    setBusy(false)
    if (failure) {
      setError(friendlyAuthError(failure))
      return
    }
    setLinkSent(true)
  }

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
    setLinkSent(false)
  }

  if (linkSent) {
    return (
      <PaperScreen screen="sign-in">
        <header className="relative flex min-h-12 items-center justify-center">
          <Link to="/welcome" aria-label="Back" className="absolute left-0 -ml-2 grid size-12 place-items-center">
            <ArrowLeft className="size-7" strokeWidth={2.2} />
          </Link>
          <h1 className="font-['Schoolbell',cursive] text-[2.3rem] leading-none">check your email</h1>
        </header>
        <p className="mt-6 text-center font-['Patrick_Hand',cursive] text-[1.4rem] leading-snug">
          we sent a sign-in link to {email.trim()}. open it on this device to finish signing in.
        </p>
        <InviteNote className="mt-4 border-[#FFD43B]" />
        <div className="mt-10 flex flex-col gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={submitMagicLink}
            className={`${paperButton} bg-[#fff]`}
          >
            {busy ? 'sending…' : 'resend link'}
          </button>
          <button
            type="button"
            onClick={() => switchMode('password')}
            className="block py-2 text-center font-['Patrick_Hand',cursive] text-[1.5rem] leading-none underline-offset-4 hover:underline"
          >
            use password instead
          </button>
        </div>
      </PaperScreen>
    )
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
      <DevLoginSection defaultEmail={email} />
      {mode === 'password' ? (
        <form onSubmit={submitPassword} className="mt-8 flex flex-col gap-5" noValidate>
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
            <div className="flex items-center gap-3 py-1" aria-hidden>
              <span className="h-px flex-1 bg-black/20" />
              <span className="font-['Patrick_Hand',cursive] text-[1.2rem] text-black/60">or</span>
              <span className="h-px flex-1 bg-black/20" />
            </div>
            <button type="button" onClick={() => switchMode('magic')} className={`${paperButton} bg-[#fff]`}>
              email me a sign-in link
            </button>
            <Link
              to="/sign-up"
              className="block py-2 text-center font-['Patrick_Hand',cursive] text-[1.5rem] leading-none underline-offset-4 hover:underline"
            >
              create account
            </Link>
          </div>
        </form>
      ) : (
        <form onSubmit={submitMagicLink} className="mt-8 flex flex-col gap-5" noValidate>
          <IconField label="email" icon={Mail} name="email" type="email" autoComplete="email" value={email} onChange={setEmail} />
          <div className="mt-6 flex flex-col gap-3">
            {error && (
              <p role="alert" className="text-center font-['Patrick_Hand',cursive] text-[1.2rem] leading-snug text-black">
                {error}
              </p>
            )}
            <button type="submit" disabled={busy} className={`${paperButton} bg-[#FFD43B]`}>
              {busy ? 'sending…' : 'email me a link →'}
            </button>
            <button
              type="button"
              onClick={() => switchMode('password')}
              className="block py-2 text-center font-['Patrick_Hand',cursive] text-[1.5rem] leading-none underline-offset-4 hover:underline"
            >
              use password instead
            </button>
            <Link
              to="/sign-up"
              className="block py-2 text-center font-['Patrick_Hand',cursive] text-[1.5rem] leading-none underline-offset-4 hover:underline"
            >
              create account
            </Link>
          </div>
        </form>
      )}
    </PaperScreen>
  )
}
