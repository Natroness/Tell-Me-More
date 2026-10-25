import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Bell, ChevronRight, Moon, Sun } from 'lucide-react'
import {
  Avatar,
  Button,
  Disclosure,
  ErrorState,
  FormError,
  Header,
  Notice,
  ScreenBody,
} from '@/components/ui/chrome'
import { LanguageSelect, TextField } from '@/components/ui/fields'
import { api } from '@/lib/api'
import { formatApiError } from '@/lib/apiError'
import { useAuth } from '@/lib/auth'
import { useDisplayMode, type DisplayMode } from '@/lib/displayMode'
import { useFamily, useFamilyTree } from '@/lib/family'
import { getPreferredLanguage, setPreferredLanguage, type LanguageId } from '@/lib/language'
import { clearDisplayName } from '@/lib/pendingProfile'
import { profileKey, useProfile } from '@/lib/profile'
import { describeMe } from '@/lib/relations'
import { activeTheme, applyTheme, type ThemeChoice } from '@/lib/theme'
import { useScreenTitle } from '@/lib/useScreenTitle'
import { AgeStepper, SectionLabel, Segmented } from '@/routes/account/controls'
import { avatarSrc, supportsAvatars } from '@/lib/avatar'
import {
  AvatarChoiceSheet,
  PhotoCropper,
  ProfilePictureButton,
  UploadProgress,
  useAvatarDraft,
} from '@/routes/account/ProfilePicture'

const MODES: { id: DisplayMode; label: string }[] = [
  { id: 'regular', label: 'regular' },
  { id: 'simplified', label: 'simplified' },
  { id: 'extra_simple', label: 'extra simple' },
]

type Profile = NonNullable<ReturnType<typeof useProfile>['data']>

/** Screen 35: profile & preferences. */
export function Account() {
  useScreenTitle('profile & preferences')
  const navigate = useNavigate()
  const { session, signOut } = useAuth()
  const profile = useProfile()
  const family = useFamily()
  const tree = useFamilyTree(family.data?.id)
  const qc = useQueryClient()
  const { mode, setMode, adopt } = useDisplayMode()
  const [theme, setTheme] = useState<ThemeChoice>(() => activeTheme())
  const [draftLanguage, setDraftLanguage] = useState<LanguageId | null>(null)
  const [languageNote, setLanguageNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const name = profile.data?.display_name?.trim() || ''
  const email = session?.user.email ?? ''
  const relation = tree.data ? describeMe(tree.data) : null
  const language = draftLanguage ?? getPreferredLanguage()

  function saved(data: Profile) {
    if (session) qc.setQueryData(profileKey(session.user.id), data)
  }

  async function chooseLanguage(next: LanguageId) {
    const before = language
    setDraftLanguage(next)
    setPreferredLanguage(next)
    setLanguageNote(null)
    const { data, error } = await api.PATCH('/api/profile', { body: { preferred_language: next } })
    if (error || !data) {
      setDraftLanguage(before)
      setPreferredLanguage(before)
      setLanguageNote({ ok: false, text: formatApiError(error, 'we could not save your language. try again.') })
      return
    }
    saved(data)
    setLanguageNote({ ok: true, text: 'language saved.' })
  }

  function chooseTheme(next: ThemeChoice) {
    applyTheme(next)
    setTheme(next)
  }

  async function logout() {
    setBusy(true)
    setSignOutError(null)
    try {
      await signOut()
      clearDisplayName()
      qc.clear()
      navigate('/', { replace: true })
    } catch {
      setBusy(false)
      setSignOutError('we could not sign out. try again.')
    }
  }

  return (
    <ScreenBody screen="account">
      <Header title="profile & preferences" back="/" />

      <section className="flex items-center gap-4">
        <Avatar
          name={name || email}
          size="lg"
          src={supportsAvatars(profile.data) ? avatarSrc(profile.data) : null}
        />
        <div className="min-w-0">
          {name && <p className="font-hand text-[2rem] leading-tight break-words">{name}</p>}
          {relation && <p className="font-sans text-[1.2rem] leading-snug break-words">{relation}</p>}
          {email && <p className="font-sans text-[1.05rem] leading-snug break-all text-muted">{email}</p>}
        </div>
      </section>
      {profile.isError && (
        <div className="mt-4">
          <ErrorState message={profile.error.message} onRetry={() => profile.refetch()} />
        </div>
      )}

      <div className="mt-7 flex flex-col gap-7">
        <div className="flex flex-col gap-2">
          <LanguageSelect value={language} onChange={chooseLanguage} />
          {languageNote && (
            <Notice tone={languageNote.ok ? 'success' : 'error'}>{languageNote.text}</Notice>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <SectionLabel>display mode</SectionLabel>
          <Segmented label="display mode" options={MODES} value={mode} onChange={setMode} />
          <p className="font-sans text-[1.05rem] leading-snug text-muted">
            {mode === 'extra_simple'
              ? 'large text, one thing at a time.'
              : mode === 'simplified'
                ? 'fewer actions, clear labels.'
                : 'every option on screen.'}
          </p>
        </div>

        {profile.data && (
          <Disclosure summary="edit profile">
            <EditProfile
              profile={profile.data}
              onSaved={(data) => {
                saved(data)
                adopt({ age: data.age, ui_mode: data.ui_mode })
              }}
            />
          </Disclosure>
        )}

        <Link
          to="/notifications"
          className="hand-box flex min-h-14 items-center gap-3 border-2 border-ink/25 px-4 font-sans text-[1.35rem]"
        >
          <Bell className="size-6 shrink-0" strokeWidth={2.2} aria-hidden />
          <span className="flex-1">notifications</span>
          <ChevronRight className="size-5 shrink-0" aria-hidden />
        </Link>

        <div className="flex flex-col gap-2">
          <SectionLabel>theme</SectionLabel>
          <Segmented
            label="theme"
            value={theme}
            onChange={chooseTheme}
            options={[
              { id: 'light', label: <><Sun className="size-5" strokeWidth={2.2} aria-hidden /> light</> },
              { id: 'dark', label: <><Moon className="size-5" strokeWidth={2.2} aria-hidden /> dark</> },
            ]}
          />
        </div>
      </div>

      <div className="mt-auto flex flex-col gap-3 pt-10">
        <FormError>{signOutError}</FormError>
        <Button tone="secondary" onClick={logout} disabled={busy}>
          {busy ? 'signing out…' : 'sign out'}
        </Button>
      </div>
    </ScreenBody>
  )
}

function EditProfile({ profile, onSaved }: { profile: Profile; onSaved: (data: Profile) => void }) {
  const [name, setName] = useState(profile.display_name ?? '')
  const [age, setAge] = useState(profile.age ?? 24)
  const draft = useAvatarDraft(profile)
  // Picture controls appear only when the server can persist them.
  const avatars = supportsAvatars(profile)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setNote(null)
    if (!name.trim()) {
      setNote({ ok: false, text: 'add your name.' })
      return
    }
    setBusy(true)
    const { data, error } = await api.PATCH('/api/profile', {
      body: { display_name: name.trim(), age, ...(avatars ? { avatar_style: draft.style, avatar_preset: draft.preset } : {}) },
    })
    setBusy(false)
    if (error || !data) {
      setNote({ ok: false, text: formatApiError(error, 'we could not save that. try again.') })
      return
    }
    onSaved(data)
    setNote({ ok: true, text: 'profile saved.' })
  }

  const saving = busy || draft.uploading

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 pt-1" noValidate>
      {avatars && (
        <div className="flex flex-col items-center gap-2">
          <ProfilePictureButton
            src={draft.preview(age)}
            name={name}
            onClick={() => draft.setSheetOpen(true)}
            disabled={draft.uploading}
          />
          <p className="font-sans text-[1.1rem] leading-tight text-muted" aria-live="polite">
            {draft.role(age)}
          </p>
          {draft.uploading && <UploadProgress value={draft.progress} />}
          {draft.error && (
            <Notice tone="error" className="w-full">
              {draft.error}
            </Notice>
          )}
        </div>
      )}
      <TextField label="your name" name="name" autoComplete="name" value={name} onChange={setName} />
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
      <AgeStepper value={age} onChange={setAge} />
      {note && <Notice tone={note.ok ? 'success' : 'error'}>{note.text}</Notice>}
      <Button type="submit" disabled={saving}>
        {draft.uploading ? 'uploading photo…' : busy ? 'saving…' : 'save'}
      </Button>
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
    </form>
  )
}
