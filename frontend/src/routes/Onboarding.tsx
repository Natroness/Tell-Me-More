import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import {
  Avatar,
  BackLink,
  Button,
  FormError,
  ScreenBody,
  TextButton,
} from '@/components/ui/chrome'
import { useScreenTitle } from '@/lib/useScreenTitle'
import { LanguageSelect } from '@/components/ui/fields'
import { formatApiError } from '@/lib/apiError'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useDisplayMode } from '@/lib/displayMode'
import { getPreferredLanguage, setPreferredLanguage, type LanguageId } from '@/lib/language'
import { clearDisplayName, nameForProfile } from '@/lib/pendingProfile'
import { profileKey, useProfile } from '@/lib/profile'
import { AgeStepper } from '@/routes/account/controls'

export function Onboarding() {
  useScreenTitle('make it yours')
  const navigate = useNavigate()
  const { session, signOut } = useAuth()
  const { adopt } = useDisplayMode()
  const profile = useProfile()
  const qc = useQueryClient()
  const savedAge = typeof profile.data?.age === 'number' ? profile.data.age : null
  const [draftAge, setDraftAge] = useState<number | null>(null)
  const age = draftAge ?? savedAge ?? 24
  const [language, setLanguage] = useState<LanguageId>(() => getPreferredLanguage())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const name = nameForProfile(session?.user.user_metadata, profile.data?.display_name)

  async function finish(e: FormEvent) {
    e.preventDefault()
    if (!session) {
      setError('create an account first.')
      return
    }
    setBusy(true)
    setError(null)
    setPreferredLanguage(language)
    const { data, error: apiError } = await api.PATCH('/api/profile', {
      body: {
        age,
        preferred_language: language,
        ...(name ? { display_name: name } : {}),
      },
    })
    setBusy(false)
    if (apiError || !data) {
      setError(formatApiError(apiError, 'we could not save that. try again.'))
      return
    }
    clearDisplayName()
    adopt({ age: data.age, ui_mode: data.ui_mode })
    qc.setQueryData(profileKey(session.user.id), data)
    navigate('/', { replace: true })
  }

  async function leave() {
    try {
      await signOut()
    } catch {
      /* leave the screen either way */
    }
    clearDisplayName()
    qc.clear()
    navigate('/', { replace: true })
  }

  return (
    <ScreenBody screen="onboarding">
      <header className="mb-5 grid grid-cols-[3rem_1fr_3rem] items-center gap-1">
        <BackLink to="/sign-up" state={{ editing: true }} />
        <h1 className="text-center font-hand text-[2.1rem] leading-[1.05]">make it yours</h1>
      </header>
      <div className="flex flex-col items-center gap-2">
        <Avatar name={name} size="lg" />
        {name && <p className="font-sans text-[1.35rem] leading-tight break-words">{name}</p>}
      </div>
      <form onSubmit={finish} className="mt-6 flex flex-1 flex-col gap-7">
        <AgeStepper value={age} onChange={setDraftAge} />
        <LanguageSelect
          value={language}
          onChange={(next) => {
            setLanguage(next)
            setPreferredLanguage(next)
          }}
        />
        <div className="mt-auto flex flex-col gap-3 pt-5">
          <FormError>{error}</FormError>
          <Button type="submit" disabled={busy}>
            {busy ? 'saving…' : 'finish →'}
          </Button>
          <TextButton onClick={leave}>sign out</TextButton>
        </div>
      </form>
    </ScreenBody>
  )
}