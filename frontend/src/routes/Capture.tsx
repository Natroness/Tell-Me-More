import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { ScreenHeader } from '@/components/ui/Screen'
import { setCapture } from '@/lib/captureStore'
import { buzz, HAPTIC } from '@/lib/haptics'

const LIMIT_S = 60

/** Brief §3B: photo/video switch, capture/stop, switch camera, upload, back, permissions, timer. */
export function Capture() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'photo' | 'video'>('photo')
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const [error, setError] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    if (mode !== 'video') return
    let cancelled = false
    async function start() {
      setError(null)
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing },
          audio: true,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
      } catch (e) {
        const name = e instanceof DOMException ? e.name : ''
        if (name === 'NotAllowedError')
          setError('Camera and microphone are blocked. Allow access, or use Upload instead.')
        else setError('Could not start the camera. Try Upload instead.')
      }
    }
    start()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [mode, facing])

  function stopTracks() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  function startRecording() {
    const stream = streamRef.current
    if (!stream) {
      setError('Camera is not ready yet. Wait a moment or use Upload instead.')
      return
    }
    setError(null)
    chunksRef.current = []
    const rec = new MediaRecorder(stream)
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'video/webm' })
      setCapture({ kind: 'video', blob, previewUrl: URL.createObjectURL(blob), mime: blob.type })
      stopTracks()
      navigate('/review')
    }
    recRef.current = rec
    rec.start()
    buzz(HAPTIC.start)
    setRecording(true)
    setElapsed(0)
    timerRef.current = window.setInterval(() => {
      setElapsed((s) => {
        if (s + 1 >= LIMIT_S) stopRecording()
        return s + 1
      })
    }, 1000)
  }

  function stopRecording() {
    if (timerRef.current) window.clearInterval(timerRef.current)
    timerRef.current = null
    setRecording(false)
    buzz(HAPTIC.stop)
    if (recRef.current?.state !== 'inactive') recRef.current?.stop()
  }

  function onPhotoFile(f: File | undefined) {
    if (!f) return
    setCapture({ kind: 'photo', blob: f, previewUrl: URL.createObjectURL(f), mime: f.type })
    navigate('/review')
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-4 px-4 py-6">
      <ScreenHeader title="Capture" />
      <p className="text-muted">Place the object inside the frame.</p>
      <div className="flex gap-2">
        {(['photo', 'video'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 rounded-lg px-4 py-2 ${mode === m ? 'bg-ink text-paper' : 'border border-ink/20 bg-white'}`}
          >
            {m === 'photo' ? 'Photo' : 'Video'}
          </button>
        ))}
      </div>

      {mode === 'photo' ? (
        <div className="flex flex-col gap-3">
          <div className="flex aspect-square items-center justify-center rounded-xl border-2 border-dashed border-ink/20 text-muted">
            Square frame — center the object
          </div>
          <label className="cursor-pointer rounded-xl bg-ink px-6 py-4 text-center text-paper">
            Open camera
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => onPhotoFile(e.target.files?.[0])}
            />
          </label>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="relative overflow-hidden rounded-xl bg-black">
            <video ref={videoRef} muted playsInline className="aspect-square w-full object-cover" />
            {recording && (
              <p className="absolute left-3 top-3 rounded bg-red-700 px-2 py-1 text-sm text-white">
                ● REC {elapsed}s / {LIMIT_S}s
              </p>
            )}
          </div>
          <div className="flex gap-2">
            {!recording ? (
              <button
                onClick={startRecording}
                className="flex-1 rounded-xl bg-ink px-6 py-4 text-paper"
              >
                Capture
              </button>
            ) : (
              <button
                onClick={stopRecording}
                className="flex-1 rounded-xl bg-red-700 px-6 py-4 text-white"
              >
                Stop ({elapsed}s)
              </button>
            )}
            <button
              onClick={() => setFacing(facing === 'environment' ? 'user' : 'environment')}
              className="rounded-xl border border-ink/20 bg-white px-4"
            >
              Switch camera
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <span className="text-sm text-muted">or</span>
        <label className="cursor-pointer rounded-lg border border-ink/20 bg-white px-4 py-2 text-sm">
          Upload instead
          <input
            type="file"
            accept={mode === 'photo' ? 'image/*' : 'video/*'}
            className="hidden"
            onChange={(e) => onPhotoFile(e.target.files?.[0])}
          />
        </label>
      </div>
      {error && (
        <div className="rounded-xl bg-red-50 p-4 text-sm text-red-900">
          <p>{error}</p>
          <p className="mt-1">Check the browser site settings, or continue with Upload instead.</p>
        </div>
      )}
    </main>
  )
}
