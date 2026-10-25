import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { Zap } from 'lucide-react'
import { paperButton } from '@/components/ui/chrome'
import { IconField } from '@/components/ui/fields'
import { useAuth } from '@/lib/auth'
import { devLoginEnabled, requestDevLogin } from '@/lib/devAuth'

/**
 * Testing-only email-only login. Renders nothing unless
 * VITE_DEV_PASSWORDLESS_LOGIN=true. No password, no email link.
 */
export function DevLoginSection({ defaultEmail = '' }: { defaultEmail?: string }) {
  const navigate = useNavigate()
  const { refreshDevSession } = useAuth()
  const [email, setEmail] = useState(defaultEmail)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!devLoginEnabled) return null

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!email.includes('@')) {
      setError('add a valid email.')
      return
    }
    setBusy(true)
    try {
      await requestDevLogin(email)
      refreshDevSession()
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'dev login failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 rounded-2xl border-2 border-dashed border-black/30 bg-[#FFF9DB] p-4">
      <p className="flex items-center gap-2 font-['Patrick_Hand',cursive] text-[1.3rem] leading-none">
        <Zap className="size-5" strokeWidth={2.2} />
        testing? skip the email
      </p>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-3" noValidate>
        <IconField
          label="email"
          icon={Zap}
          name="dev-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
        />
        {error && (
          <p role="alert" className="text-center font-['Patrick_Hand',cursive] text-[1.2rem] leading-snug text-black">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className={`${paperButton} bg-[#FFD43B]`}>
          {busy ? 'jumping in…' : 'just log me in →'}
        </button>
        <p className="text-center font-['Patrick_Hand',cursive] text-[1.05rem] leading-snug text-black/60">
          dev only. needs backend DEV_PASSWORDLESS_LOGIN=true. no password, no link.
        </p>
      </form>
    </div>
  )
}
