import type { Client } from 'openapi-fetch'
import type { components } from '@/api-types'
import { api } from '@/lib/api'
import boy from '@/image/avatars/bro.png'
import girl from '@/image/avatars/sis.png'
import man from '@/image/avatars/Dad.png'
import woman from '@/image/avatars/mom.png'
import olderMan from '@/image/avatars/grandpa.png'
import olderWoman from '@/image/avatars/grandma.png'

export type AvatarStyle = 'male' | 'female'

/*
 * Backend contract for avatars. main's backend does not serve it yet (no
 * `avatar_style` / `avatar_url` on Profile, no /api/profile/avatar routes, no
 * `avatars` bucket), so `make types` cannot produce these. Declared here by
 * hand so the call sites are typed; delete this block once the backend ships
 * the endpoints and `make types` emits them.
 */
export type Profile = components['schemas']['Profile'] & {
  avatar_style?: AvatarStyle | null
  avatar_url?: string | null
}

/** True only when the server's profile response carries the avatar fields. */
export function supportsAvatars(profile: Profile | null | undefined): boolean {
  return !!profile && 'avatar_style' in profile
}

type Json<T> = { content: { 'application/json': T } }
type NoParams = { query?: never; header?: never; path?: never; cookie?: never }
type Invalid = Json<components['schemas']['HTTPValidationError']>
type AvatarPaths = {
  '/api/profile/avatar': {
    post: {
      parameters: NoParams
      requestBody: Json<{ photo_mime: string }>
      responses: { 200: Json<{ upload_url: string; avatar_path: string }>; 422: Invalid }
    }
    delete: { parameters: NoParams; requestBody?: never; responses: { 200: Json<Profile>; 422: Invalid } }
  }
  '/api/profile/avatar/complete': {
    post: {
      parameters: NoParams
      requestBody: Json<{ avatar_path: string }>
      responses: { 200: Json<Profile>; 422: Invalid }
    }
  }
}
/** The shared authenticated client, typed for the avatar routes. */
export const avatarApi = api as unknown as Client<AvatarPaths>

/** Uploaded photos must stay small enough for Supabase + phone screens. */
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024

const CHILD_MAX = 17
const ADULT_MAX = 50

const illustrations = { boy, girl, man, woman, olderMan, olderWoman } as const

/** Illustrated avatar for a style + age: child 5–17, adult 18–50, older 51+. */
export function avatarIllustration(style: AvatarStyle, age: number): string {
  if (age <= CHILD_MAX) return style === 'male' ? illustrations.boy : illustrations.girl
  if (age <= ADULT_MAX) return style === 'male' ? illustrations.man : illustrations.woman
  return style === 'male' ? illustrations.olderMan : illustrations.olderWoman
}

/** Header/footer caption for the current pick. */
export function avatarRole(style: AvatarStyle, age: number): string {
  if (age <= CHILD_MAX) return style === 'male' ? 'boy' : 'girl'
  if (age <= ADULT_MAX) return style === 'male' ? 'man' : 'woman'
  return style === 'male' ? 'older man' : 'older woman'
}

/** The preview shows a custom photo first, the illustrated avatar otherwise. */
export function avatarSrc(
  profile: Pick<Profile, 'avatar_url' | 'avatar_style' | 'age'> | null | undefined,
  fallbackAge = 24,
): string {
  if (profile?.avatar_url) return profile.avatar_url
  return avatarIllustration(profile?.avatar_style ?? 'male', profile?.age ?? fallbackAge)
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
