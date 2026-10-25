import { useEffect, useId, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Camera, ImagePlus, Smile } from 'lucide-react'
import { Avatar, Button, FormError } from '@/components/ui/chrome'
import { api } from '@/lib/api'
import { formatApiError } from '@/lib/apiError'
import {
  AVATAR_PRESETS,
  presetFor,
  presetLabel,
  presetUrl,
  putWithProgress,
  validatePhoto,
  type AvatarPreset,
  type AvatarStyle,
  type Profile,
} from '@/lib/avatar'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import { profileKey } from '@/lib/profile'

/** Round preview with a camera badge. Opens the upload / illustrated-avatar choice. */
export function ProfilePictureButton({
  src,
  name,
  onClick,
  disabled,
}: {
  src: string | null
  name?: string | null
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="change profile picture"
      className="relative grid place-items-center rounded-full disabled:opacity-60"
    >
      <Avatar name={name} src={src} size="lg" />
      <span
        aria-hidden
        className="absolute -right-1 -bottom-1 grid size-9 place-items-center rounded-full border-2 border-ink bg-sun text-black"
      >
        <Camera className="size-5" strokeWidth={2.2} />
      </span>
    </button>
  )
}

/** Bottom sheet: upload a photo, pick one of the six illustrations, or follow style + age. */
export function AvatarChoiceSheet({
  open,
  hasCustom,
  preset,
  onUpload,
  onPickPreset,
  onUseIllustrated,
  onClose,
}: {
  open: boolean
  hasCustom: boolean
  /** The illustration picked by hand, if any. */
  preset?: AvatarPreset | null
  onUpload: (file: File | undefined) => void
  onPickPreset?: (preset: AvatarPreset) => void
  onUseIllustrated: () => void
  onClose: () => void
}) {
  const id = useId()
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center bg-ink/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="profile picture"
    >
      <div
        className="w-full max-w-[390px] rounded-t-[1.5rem] border-2 border-b-0 border-ink bg-paper p-6 pb-10"
        onClick={(e) => e.stopPropagation()}
      >
        <label
          htmlFor={id}
          className="hand-box flex min-h-16 cursor-pointer items-center gap-3 border-2 border-ink px-4 font-sans text-[1.4rem]"
        >
          <ImagePlus className="size-6 shrink-0" strokeWidth={2.2} aria-hidden />
          upload my photo
          <input
            id={id}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              onUpload(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </label>
        {onPickPreset && (
          <fieldset className="mt-4">
            <legend className="font-sans text-[1.2rem] text-muted">or pick one</legend>
            <div className="mt-2 grid grid-cols-3 gap-3">
              {AVATAR_PRESETS.map((p) => {
                const current = !hasCustom && preset === p.id
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onPickPreset(p.id)}
                    aria-pressed={current}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-2xl border-2 p-2 font-sans text-[1.05rem]',
                      current ? 'border-sun bg-sun/20' : 'border-transparent',
                    )}
                  >
                    <img src={presetUrl(p.id)} alt="" className="size-16 rounded-full border-2 border-ink object-cover" />
                    {p.label}
                  </button>
                )
              })}
            </div>
          </fieldset>
        )}
        <button
          type="button"
          onClick={onUseIllustrated}
          className="hand-box mt-3 flex min-h-16 w-full items-center gap-3 border-2 border-ink px-4 font-sans text-[1.4rem]"
        >
          <Smile className="size-6 shrink-0" strokeWidth={2.2} aria-hidden />
          match my age
          {!hasCustom && !preset && <span className="ml-auto text-muted">current</span>}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 w-full py-3 text-center font-sans text-[1.3rem] text-muted"
        >
          cancel
        </button>
      </div>
    </div>
  )
}

/** Square preview: drag to move, slider to zoom, then save a 512px photo. */
export function PhotoCropper({
  src,
  error,
  onConfirm,
  onCancel,
}: {
  src: string
  error: string | null
  /** Blob is always square; sourceSize is how many original pixels the crop covers. */
  onConfirm: (blob: Blob, sourceSize: number) => void
  onCancel: () => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [natural, setNatural] = useState({ w: 0, h: 0 })
  const [box, setBox] = useState(0)
  const [zoom, setZoom] = useState(1.2)
  const [off, setOff] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  useEffect(() => {
    const img = new Image()
    img.src = src
    img.onload = () => setNatural({ w: img.naturalWidth, h: img.naturalHeight })
    setBox(boxRef.current?.clientWidth ?? 0)
  }, [src])

  // Half of the overflow on each side; the crop window cannot leave the photo.
  function clamp(x: number, y: number) {
    if (!natural.w || !box) return { x: 0, y: 0 }
    const base = Math.max(box / natural.w, box / natural.h)
    const mx = Math.max(0, (natural.w * base * zoom - box) / 2)
    const my = Math.max(0, (natural.h * base * zoom - box) / 2)
    return { x: Math.min(mx, Math.max(-mx, x)), y: Math.min(my, Math.max(-my, y)) }
  }

  function confirm() {
    const img = new Image()
    img.src = src
    img.onload = () => {
      const base = Math.max(box / img.naturalWidth, box / img.naturalHeight)
      const unit = base * zoom
      const size = box / unit
      const cx = img.naturalWidth / 2 - off.x / unit
      const cy = img.naturalHeight / 2 - off.y / unit
      const canvas = document.createElement('canvas')
      canvas.width = 512
      canvas.height = 512
      canvas.getContext('2d')!.drawImage(img, cx - size / 2, cy - size / 2, size, size, 0, 0, 512, 512)
      canvas.toBlob(
        (blob) => blob && onConfirm(blob, size),
        'image/jpeg',
        0.92,
      )
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 overflow-y-auto bg-paper"
      role="dialog"
      aria-modal="true"
      aria-label="crop photo"
    >
      <div className="mx-auto flex min-h-full w-full max-w-[390px] flex-col px-7 pt-10 pb-8">
        <h2 className="text-center font-hand text-[2.1rem] leading-none">make it square</h2>
        <p className="mt-2 text-center font-sans text-[1.15rem] text-muted">drag to move · slide to zoom</p>
        <div
          ref={boxRef}
          className="hand-box mt-6 aspect-square w-full touch-none overflow-hidden border-2 border-ink"
          onPointerDown={(e) => {
            ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
            drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y }
          }}
          onPointerMove={(e) => {
            const d = drag.current
            if (d) setOff(clamp(d.ox + e.clientX - d.x, d.oy + e.clientY - d.y))
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        >
          <img
            src={src}
            alt="photo to crop"
            draggable={false}
            className="size-full object-cover"
            style={{ transform: `translate(${off.x}px, ${off.y}px) scale(${zoom})` }}
          />
        </div>
        <div className="mt-5 flex items-center gap-3">
          <span className="font-sans text-[1.2rem]" aria-hidden>−</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            aria-label="zoom"
            onChange={(e) => setZoom(Number(e.target.value))}
            className="age-slider min-w-0 flex-1"
          />
          <span className="font-sans text-[1.2rem]" aria-hidden>+</span>
        </div>
        <div className="mt-auto flex flex-col gap-3 pt-8">
          <FormError>{error}</FormError>
          <Button onClick={confirm}>use this photo</Button>
          <button
            type="button"
            onClick={onCancel}
            className="w-full py-2 text-center font-sans text-[1.3rem] text-muted"
          >
            cancel
          </button>
        </div>
      </div>
    </div>
  )
}

/** Yellow progress bar for the photo upload. */
export function UploadProgress({ value }: { value: number }) {
  return (
    <div role="status" aria-label={`uploading photo ${Math.round(value * 100)} percent`}>
      <div className="h-3 overflow-hidden rounded-full border-[1.5px] border-ink">
        <div className="h-full bg-sun transition-[width]" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <p className="mt-1 text-center font-sans text-[1.05rem] text-muted">
        uploading photo… {Math.round(value * 100)}%
      </p>
    </div>
  )
}

type Draft = {
  style: AvatarStyle
  setStyle: (s: AvatarStyle) => void
  /** Picked by hand from the six; null follows style + age. Saves with the form. */
  preset: AvatarPreset | null
  pickPreset: (p: AvatarPreset) => void
  /** What the preview shows now: custom photo first, illustrated avatar otherwise. */
  preview: (age: number) => string | null
  /** Caption under the preview. */
  role: (age: number) => string
  hasCustom: boolean
  uploading: boolean
  progress: number
  error: string | null
  sheetOpen: boolean
  setSheetOpen: (open: boolean) => void
  cropSrc: string | null
  clearCrop: () => void
  chooseFile: (file: File | undefined) => void
  confirmCrop: (blob: Blob, sourceSize: number) => void
  useIllustrated: () => void
}

/**
 * Avatar style + custom photo draft. The photo uploads the moment a crop is
 * confirmed (single-slot path, so abandoning never orphans bytes); the style
 * saves with the surrounding form. Changing style or age never drops a photo.
 */
export function useAvatarDraft(profile: Profile | null | undefined): Draft {
  const qc = useQueryClient()
  const { session } = useAuth()
  const [style, setStyleState] = useState<AvatarStyle>('male')
  const [preset, setPreset] = useState<AvatarPreset | null>(null)
  const [customUrl, setCustomUrl] = useState<string | null>(null)
  // Adopt the server profile once per account; later refetches must not
  // clobber a style the user just picked or a photo they just uploaded.
  const [seenId, setSeenId] = useState<string | null>(null)
  if (profile && seenId !== profile.user_id) {
    setSeenId(profile.user_id)
    setStyleState(profile.avatar_style ?? 'male')
    setPreset(profile.avatar_preset ?? null)
    setCustomUrl(profile.avatar_url ?? null)
  }
  const [sheetOpen, setSheetOpen] = useState(false)
  const [cropSrc, setCropSrc] = useState<string | null>(null)
  const cropUrl = useRef<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  function clearCrop() {
    if (cropUrl.current) URL.revokeObjectURL(cropUrl.current)
    cropUrl.current = null
    setCropSrc(null)
  }

  function saved(data: Profile) {
    if (session) qc.setQueryData(profileKey(session.user.id), data)
  }

  // Choosing a style means "match my age" again.
  function setStyle(s: AvatarStyle) {
    setError(null)
    setStyleState(s)
    setPreset(null)
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return
    const problem = await validatePhoto(file)
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    setSheetOpen(false)
    if (cropUrl.current) URL.revokeObjectURL(cropUrl.current)
    cropUrl.current = URL.createObjectURL(file)
    setCropSrc(cropUrl.current)
  }

  async function confirmCrop(blob: Blob, sourceSize: number) {
    if (sourceSize < 96) {
      setError('zoom out a little — that crop is too small to look sharp.')
      return
    }
    setUploading(true)
    setProgress(0)
    setError(null)
    try {
      const created = await api.POST('/api/profile/avatar', {
        body: { photo_mime: blob.type || 'image/jpeg' },
      })
      if (created.error || !created.data)
        throw new Error(formatApiError(created.error, "we couldn't start the upload. try again."))
      await putWithProgress(created.data.upload_url, blob, setProgress)
      const done = await api.POST('/api/profile/avatar/complete', {
        body: { avatar_path: created.data.avatar_path },
      })
      if (done.error || !done.data)
        throw new Error(formatApiError(done.error, "we couldn't save that photo. try again."))
      setCustomUrl(done.data.avatar_url ?? null)
      saved(done.data)
      clearCrop()
    } catch (e) {
      setError(e instanceof Error ? e.message : "we couldn't save that photo. try again.")
    } finally {
      setUploading(false)
    }
  }

  async function useIllustrated() {
    setSheetOpen(false)
    setError(null)
    setPreset(null)
    await dropPhoto()
  }

  async function pickPreset(p: AvatarPreset) {
    setSheetOpen(false)
    setError(null)
    setPreset(p)
    await dropPhoto()
  }

  async function dropPhoto() {
    if (!customUrl) return
    setUploading(true)
    try {
      const { data, error } = await api.DELETE('/api/profile/avatar')
      if (error || !data)
        throw new Error(formatApiError(error, "we couldn't remove that photo. try again."))
      setCustomUrl(null)
      saved(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "we couldn't remove that photo. try again.")
    } finally {
      setUploading(false)
    }
  }

  return {
    style,
    setStyle,
    preset,
    pickPreset,
    preview: (age: number) => customUrl ?? presetUrl(preset ?? presetFor(style, age)),
    role: (age: number) => (customUrl ? 'my photo' : presetLabel(preset ?? presetFor(style, age))),
    hasCustom: customUrl != null,
    uploading,
    progress,
    error,
    sheetOpen,
    setSheetOpen,
    cropSrc,
    clearCrop,
    chooseFile,
    confirmCrop,
    useIllustrated,
  }
}
