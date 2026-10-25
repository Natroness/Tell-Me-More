import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { ArrowLeft, Lock, Mail, User } from 'lucide-react'
import { FormError, InviteNote, PaperScreen, paperButton } from '@/components/ui/chrome'
import { useScreenTitle } from '@/lib/useScreenTitle'
import { IconField } from '@/components/ui/fields'
import { friendlyAuthError, missingSupabaseConfig } from '@/lib/apiError'
import { useAuth } from '@/lib/auth'
import { sendSignUpLink } from '@/lib/magicLink'
import { readDisplayName, stashDisplayName } from '@/lib/pendingProfile'
import { supabase, supabaseConfigured } from '@/lib/supabase'
import { DevLoginSection } from '@/components/DevLogin'

type Mode = 'password' | 'magic'

export function SignUp() {
  useScreenTitle('create account')
  const navigate = useNavigate()
  const location = useLocation()
  const { session } = useAuth()
  const editing = Boolean((location.state as { editing?: boolean } | null)?.editing && session)
  const [name, setName] = useState(() => readDisplayName())
  const [email, setEmail] = useState(session?.user.email ?? '')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<Mode>('password')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [checkEmail, setCheckEmail] = useState(false)

  // Editing an existing session is name-only; no passwordless toggle there.
  const showMagicToggle = !editing && !session

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const displayName = name.trim()
    if (!displayName) {
      setError('add your name.')
      return
    }
    if (!session && !email.includes('@')) {
      setError('add a valid email.')
      return
    }
    if (mode === 'magic') {
      if (!supabaseConfigured) {
        setError(missingSupabaseConfig)
        return
      }
      stashDisplayName(displayName)
      if (session) {
        navigate('/onboarding')
        return
      }
      setBusy(true)
      const failure = await sendSignUpLink(email, displayName)
      setBusy(false)
      if (failure) {
        setError(friendlyAuthError(failure))
        return
      }
      setCheckEmail(true)
      return
    }
    if (!session && password.length < 6) {
      setError('use at least 6 characters.')
      return
    }
    stashDisplayName(displayName)
    if (session) {
      navigate('/onboarding')
      return
    }
    if (!supabaseConfigured) {
      setError(missingSupabaseConfig)
      return
    }
    setBusy(true)
    const { data, error: authError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { display_name: displayName },
      },
    })
    setBusy(false)
    if (authError) {
      setError(friendlyAuthError(authError.message))
      return
    }
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      setError('an account with that email already exists. sign in instead.')
      return
    }
    if (!data.session) {
      setCheckEmail(true)
      return
    }
    navigate('/onboarding', { replace: true })
  }

  if (checkEmail) {
    return (
      <PaperScreen screen="check-email">
        <Header back="/welcome" title="check your email" />
        <p className="mt-6 text-center font-['Patrick_Hand',cursive] text-[1.4rem] leading-snug">
          {mode === 'magic'
            ? `we sent a sign-in link to ${email.trim()}. open it on this device to finish making it yours.`
            : `we sent a link to ${email.trim()}. open it, then sign in to finish making it yours.`}
        </p>
        <InviteNote className="mt-4 border-[#FFD43B]" />
        <Link to="/sign-in" className={`${paperButton} mt-10 bg-[#FFD43B]`}>
          sign in →
        </Link>
      </PaperScreen>
    )
  }

  return (
    <PaperScreen screen="sign-up">
      <Header back={editing ? '/onboarding' : '/welcome'} title="create account" />
      <InviteNote className="mt-6 border-[#FFD43B]" />
      {!editing && <DevLoginSection defaultEmail={email} />}
      <form onSubmit={submit} className="mt-8 flex flex-col gap-5" noValidate>
        <IconField label="your name" icon={User} name="name" autoComplete="name" value={name} onChange={setName} />
        <IconField
          label="email"
          icon={Mail}
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
          readOnly={editing}
        />
        {!editing && mode === 'password' && (
          <IconField
            label="password"
            icon={Lock}
            name="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
          />
        )}
        <div className="mt-6 flex flex-col gap-3">
          <FormError>{error}</FormError>
          <button type="submit" disabled={busy} className={`${paperButton} bg-[#FFD43B]`}>
            {busy ? 'please wait…' : mode === 'magic' ? 'email me a link →' : 'continue →'}
          </button>
          {showMagicToggle &&
            (mode === 'password' ? (
              <>
                <div className="flex items-center gap-3 py-1" aria-hidden>
                  <span className="h-px flex-1 bg-black/20" />
                  <span className="font-['Patrick_Hand',cursive] text-[1.2rem] text-black/60">or</span>
                  <span className="h-px flex-1 bg-black/20" />
                </div>
                <button type="button" onClick={() => switchMode('magic')} className={`${paperButton} bg-[#fff]`}>
                  get a magic link instead
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => switchMode('password')}
                className="block py-2 text-center font-['Patrick_Hand',cursive] text-[1.5rem] leading-none underline-offset-4 hover:underline"
              >
                use a password instead
              </button>
            ))}
        </div>
      </form>
    </PaperScreen>
  )
}

function Header({ back, title }: { back: string; title: string }) {
  return (
    <header className="relative flex min-h-12 items-center justify-center">
      <Link to={back} aria-label="Back" className="absolute left-0 -ml-2 grid size-12 place-items-center">
        <ArrowLeft className="size-7" strokeWidth={2.2} />
      </Link>
      <h1 className="font-['Schoolbell',cursive] text-[2.3rem] leading-none">{title}</h1>
    </header>
  )
}
