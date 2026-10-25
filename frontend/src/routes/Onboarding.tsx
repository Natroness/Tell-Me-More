import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import {
  Avatar,
  BackLink,
  Button,
  FormError,
  Notice,
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
import { supportsAvatars } from '@/lib/avatar'
import { AgeStepper, SectionLabel, Segmented } from '@/routes/account/controls'
import {
  AvatarChoiceSheet,
  PhotoCropper,
  ProfilePictureButton,
  UploadProgress,
  useAvatarDraft,
} from '@/routes/account/ProfilePicture'

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
  const draft = useAvatarDraft(profile.data)
  // Picture controls appear only when the server can persist them.
  const avatars = supportsAvatars(profile.data)
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
        ...(avatars ? { avatar_style: draft.style, avatar_preset: draft.preset } : {}),
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

  const saving = busy || draft.uploading

  return (
    <ScreenBody screen="onboarding">
      <header className="mb-5 grid grid-cols-[3rem_1fr_3rem] items-center gap-1">
        <BackLink to="/sign-up" state={{ editing: true }} />
        <h1 className="text-center font-hand text-[2.1rem] leading-[1.05]">make it yours</h1>
      </header>
      <div className="flex flex-col items-center gap-2">
        {avatars ? (
          <ProfilePictureButton
            src={draft.preview(age)}
            name={name}
            onClick={() => draft.setSheetOpen(true)}
            disabled={draft.uploading}
          />
        ) : (
          <Avatar name={name} size="lg" />
        )}
        {name && <p className="font-sans text-[1.35rem] leading-tight break-words">{name}</p>}
        {avatars && (
          <p className="font-sans text-[1.1rem] leading-tight text-muted" aria-live="polite">
            {draft.role(age)}
          </p>
        )}
        {avatars && draft.uploading && (
          <div className="w-full max-w-[16rem]">
            <UploadProgress value={draft.progress} />
          </div>
        )}
        {avatars && draft.error && (
          <Notice tone="error" className="w-full">
            {draft.error}
          </Notice>
        )}
      </div>
      <form onSubmit={finish} className="mt-6 flex flex-1 flex-col gap-7">
        {avatars && (
          <div className="flex flex-col gap-2">
            <SectionLabel>i am</SectionLabel>
            <Segmented
              label="avatar style"
              value={draft.style}
              onChange={draft.setStyle}
              options={[
                { id: 'male', label: 'male' },
                { id: 'female', label: 'female' },
              ]}
            />
          </div>
        )}
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
          <Button type="submit" disabled={saving}>
            {draft.uploading ? 'uploading photo…' : busy ? 'saving…' : 'finish →'}
          </Button>
          <TextButton onClick={leave}>sign out</TextButton>
        </div>
      </form>
      {avatars && (
        <>
          <AvatarChoiceSheet
            open={draft.sheetOpen}
            hasCustom={draft.hasCustom}
            preset={draft.preset}
            onUpload={draft.chooseFile}
            onPickPreset={draft.pickPreset}
            onUseIllustrated={draft.useIllustrated}
            onClose={() => draft.setSheetOpen(false)}
          />
          {draft.cropSrc && (
            <PhotoCropper
              src={draft.cropSrc}
              error={draft.error}
              onConfirm={draft.confirmCrop}
              onCancel={draft.clearCrop}
            />
          )}
        </>
      )}
    </ScreenBody>
  )
}
