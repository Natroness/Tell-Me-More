import type { components } from '@/api-types'

export type Profile = components['schemas']['Profile']
export type AvatarStyle = NonNullable<Profile['avatar_style']>
export type AvatarPreset = NonNullable<Profile['avatar_preset']>

/** True only when the server's profile response carries the avatar fields. */
export function supportsAvatars(profile: Profile | null | undefined): boolean {
  return !!profile && 'avatar_style' in profile
}

/** Uploaded photos must stay small enough for Supabase + phone screens. */
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024

const CHILD_MAX = 17
const ADULT_MAX = 50

/** The six illustrations, in the public `avatars` bucket (backend/scripts/upload_avatars.py). */
export const AVATAR_PRESETS: { id: AvatarPreset; label: string }[] = [
  { id: 'boy', label: 'boy' },
  { id: 'girl', label: 'girl' },
  { id: 'man', label: 'man' },
  { id: 'woman', label: 'woman' },
  { id: 'older-man', label: 'older man' },
  { id: 'older-woman', label: 'older woman' },
]

export function presetUrl(preset: AvatarPreset): string {
  return `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/avatars/presets/${preset}.png`
}

/** Illustration for a style + age: child 5–17, adult 18–50, older 51+. */
export function presetFor(style: AvatarStyle, age: number): AvatarPreset {
  if (age <= CHILD_MAX) return style === 'male' ? 'boy' : 'girl'
  if (age <= ADULT_MAX) return style === 'male' ? 'man' : 'woman'
  return style === 'male' ? 'older-man' : 'older-woman'
}

export function presetLabel(preset: AvatarPreset): string {
  return AVATAR_PRESETS.find((p) => p.id === preset)?.label ?? preset
}

/** The preview shows a custom photo first, then the picked illustration, then style + age. */
export function avatarSrc(
  profile: Pick<Profile, 'avatar_url' | 'avatar_style' | 'avatar_preset' | 'age'> | null | undefined,
  fallbackAge = 24,
): string {
  if (profile?.avatar_url) return profile.avatar_url
  return presetUrl(profile?.avatar_preset ?? presetFor(profile?.avatar_style ?? 'male', profile?.age ?? fallbackAge))
}

/**
 * Reject files the cropper or the backend cannot handle, before any upload.
 * `image/*` only, ≤15 MB, and it must decode as an image (not a renamed file).
 */
export async function validatePhoto(file: File): Promise<string | null> {
  if (!file.type.startsWith('image/')) return 'choose a photo file.'
  if (file.size > MAX_PHOTO_BYTES) return 'that photo is too big (max 15 MB).'
  try {
    const url = URL.createObjectURL(file)
    try {
      await new Promise<void>((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('unreadable'))
        img.src = url
      })
    } finally {
      URL.revokeObjectURL(url)
    }
  } catch {
    return "we couldn't read that file. try another photo."
  }
  return null
}

/** PUT bytes to a signed URL with upload progress (fetch cannot report it). */
export function putWithProgress(url: string, blob: Blob, onProgress: (value: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const req = new XMLHttpRequest()
    req.open('PUT', url)
    req.setRequestHeader('Content-Type', blob.type || 'image/jpeg')
    req.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    req.onload = () =>
      req.status >= 200 && req.status < 300
        ? (onProgress(1), resolve())
        : reject(new Error(`upload failed (status ${req.status}). try again.`))
    req.onerror = () => reject(new Error('the upload lost connection. try again.'))
    req.onabort = () => reject(new Error('the upload was cancelled. try again.'))
    req.send(blob)
  })
}
