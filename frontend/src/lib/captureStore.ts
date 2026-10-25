/** In-memory capture handed from Capture → Review → Archive (cleared on send). */

export type CaptureKind = 'photo' | 'video'

export type Capture = {
  kind: CaptureKind
  blob: Blob
  previewUrl: string
  mime: string
}

let current: Capture | null = null

export function setCapture(c: Capture) {
  if (current?.previewUrl.startsWith('blob:')) URL.revokeObjectURL(current.previewUrl)
  current = c
}

export function getCapture(): Capture | null {
  return current
}

export function clearCapture() {
  if (current?.previewUrl.startsWith('blob:')) URL.revokeObjectURL(current.previewUrl)
  current = null
}
