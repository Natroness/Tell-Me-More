/** A JPEG still from a video, for the AI to read. Taken a little in, past any opening blur. */
export async function videoFrame(video: Blob): Promise<Blob> {
  const url = URL.createObjectURL(video)
  try {
    const el = document.createElement('video')
    el.muted = true
    el.playsInline = true
    el.src = url
    await new Promise<void>((resolve, reject) => {
      el.onloadedmetadata = () => resolve()
      el.onerror = () => reject(new Error('could not read video'))
    })
    // Recorded webm often reports Infinity until seeked; fall back to a fixed offset.
    const at = Number.isFinite(el.duration) ? Math.min(1, el.duration / 2) : 0.5
    await new Promise<void>((resolve) => {
      el.onseeked = () => resolve()
      el.currentTime = at
    })
    const canvas = document.createElement('canvas')
    canvas.width = el.videoWidth
    canvas.height = el.videoHeight
    canvas.getContext('2d')!.drawImage(el, 0, 0)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no frame'))), 'image/jpeg', 0.9),
    )
  } finally {
    URL.revokeObjectURL(url)
  }
}
