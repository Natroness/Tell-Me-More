import { Camera, ImageIcon, SwitchCamera } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Header, Notice, ScreenBody } from '@/components/ui/chrome'
import { setCapture } from '@/lib/captureStore'
import { buzz, HAPTIC } from '@/lib/haptics'
import { useScreenTitle } from '@/lib/useScreenTitle'
import { cn } from '@/lib/utils'

const LIMIT_S = 60

/** Screen 06: live square frame, photo/video, shutter, switch camera, upload, permission errors. */
export function Capture() {
  useScreenTitle('take a photo')
  const navigate = useNavigate()
  const [mode, setMode] = useState<'photo' | 'video'>('photo')
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState(false)
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const elapsedRef = useRef(0)
  const nativeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    async function start() {
      setError(null)
      setLive(false)
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing },
          audio: mode === 'video',
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
        setLive(true)
      } catch (e) {
        if (cancelled) return
        const name = e instanceof DOMException ? e.name : ''
        if (name === 'NotAllowedError')
          setError(
            mode === 'video'
              ? 'the camera and microphone are blocked. allow them in your browser settings, or upload a video instead.'
              : 'the camera is blocked. allow it in your browser settings, or tap the shutter to use your phone camera.',
          )
        else
          setError(
            mode === 'video'
              ? 'we could not start the camera. try uploading a video instead.'
              : 'we could not start the camera. tap the shutter to use your phone camera, or upload a photo.',
          )
      }
    }
    start()
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [mode, facing])

  useEffect(
    () => () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
      const rec = recRef.current
      if (rec && rec.state !== 'inactive') {
        rec.onstop = null
        rec.stop()
      }
    },
    [],
  )

  function stopTracks() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  function takePhoto() {
    buzz(HAPTIC.start)
    const video = videoRef.current
    if (!live || !video || !video.videoWidth) {
      nativeRef.current?.click()
      return
    }
    const side = Math.min(video.videoWidth, video.videoHeight)
    const canvas = document.createElement('canvas')
    canvas.width = side
    canvas.height = side
    canvas
      .getContext('2d')!
      .drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, side, side)
    canvas.toBlob(
      (blob) => {
        if (!blob) return setError('that photo did not work. try again, or upload one instead.')
        setCapture({ kind: 'photo', blob, previewUrl: URL.createObjectURL(blob), mime: 'image/jpeg' })
        stopTracks()
        navigate('/review')
      },
      'image/jpeg',
      0.92,
    )
  }

  function startRecording() {
    const stream = streamRef.current
    if (!stream) {
      setError('the camera is not ready yet. wait a moment, or upload a video instead.')
      return
    }
    buzz(HAPTIC.start)
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
    setRecording(true)
    elapsedRef.current = 0
    setElapsed(0)
    timerRef.current = window.setInterval(() => {
      elapsedRef.current += 1
      setElapsed(elapsedRef.current)
      if (elapsedRef.current >= LIMIT_S) stopRecording()
    }, 1000)
  }

  function stopRecording() {
    buzz(HAPTIC.stop)
    if (timerRef.current) window.clearInterval(timerRef.current)
    timerRef.current = null
    setRecording(false)
    if (recRef.current?.state !== 'inactive') recRef.current?.stop()
  }

  function onFile(f: File | undefined) {
    if (!f) return
    const kind = f.type.startsWith('video/') ? 'video' : 'photo'
    setCapture({ kind, blob: f, previewUrl: URL.createObjectURL(f), mime: f.type })
    stopTracks()
    navigate('/review')
  }

  function shutter() {
    if (mode === 'photo') takePhoto()
    else if (recording) stopRecording()
    else startRecording()
  }

  return (
    <ScreenBody screen="camera">
      <Header title={mode === 'photo' ? 'take a photo' : 'record a video'} />
      <div className="hand-box relative aspect-square overflow-hidden border-2 border-ink">
        <video
          ref={videoRef}
          muted
          playsInline
          className={cn('size-full object-cover', facing === 'user' && '-scale-x-100', !live && 'hidden')}
        />
        {!live && (
          <div className="grid size-full place-items-center text-muted">
            <Camera className="size-16" strokeWidth={1.8} aria-hidden />
          </div>
        )}
        <FrameCorners />
        {recording && (
          <p className="absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border-2 border-ink bg-paper px-3 py-0.5 font-sans text-[1.1rem] tabular-nums">
            <span className="size-3 animate-pulse rounded-full bg-sun ring-2 ring-ink" aria-hidden />
            rec {elapsed}s / {LIMIT_S}s
          </p>
        )}
      </div>
      <p className="mt-3 text-center font-sans text-[1.3rem] leading-snug">place it in the frame</p>

      <div
        role="radiogroup"
        aria-label="capture mode"
        className="mx-auto mt-4 flex rounded-full border-2 border-ink p-1"
      >
        {(['photo', 'video'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            disabled={recording}
            onClick={() => setMode(m)}
            className={cn(
              'min-h-11 rounded-full px-6 font-sans text-[1.25rem] disabled:opacity-50',
              mode === m && 'bg-sun text-black',
            )}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-[1fr_auto_1fr] items-center">
        <label
          className="grid size-14 cursor-pointer place-items-center justify-self-start rounded-2xl border-2 border-ink"
          aria-label={mode === 'photo' ? 'upload a photo' : 'upload a video'}
        >
          <ImageIcon className="size-7" strokeWidth={2.2} aria-hidden />
          <input
            type="file"
            accept={mode === 'photo' ? 'image/*' : 'video/*'}
            className="hidden"
            disabled={recording}
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </label>
        <button
          type="button"
          onClick={shutter}
          aria-label={mode === 'photo' ? 'take photo' : recording ? `stop recording (${elapsed}s)` : 'start recording'}
          className="grid size-22 place-items-center rounded-full border-[3px] border-ink bg-sun transition active:scale-95"
        >
          {recording ? (
            <span className="size-8 rounded-md bg-ink" aria-hidden />
          ) : (
            <span className="size-16 rounded-full border-2 border-ink/70" aria-hidden />
          )}
        </button>
        <button
          type="button"
          onClick={() => setFacing(facing === 'environment' ? 'user' : 'environment')}
          disabled={recording}
          aria-label="switch camera"
          className="grid size-14 place-items-center justify-self-end rounded-full border-2 border-ink disabled:opacity-50"
        >
          <SwitchCamera className="size-7" strokeWidth={2.2} aria-hidden />
        </button>
      </div>
      {mode === 'video' && !recording && (
        <p className="mt-3 text-center font-sans text-[1.1rem] text-muted">up to {LIMIT_S} seconds</p>
      )}

      <input
        ref={nativeRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      {error && (
        <Notice tone="error" title="camera" className="mt-5">
          {error}
        </Notice>
      )}
    </ScreenBody>
  )
}

function FrameCorners() {
  const base = 'pointer-events-none absolute size-12 border-sun'
  return (
    <>
      <span className={cn(base, 'top-3 left-3 rounded-tl-xl border-t-[5px] border-l-[5px]')} aria-hidden />
      <span className={cn(base, 'top-3 right-3 rounded-tr-xl border-t-[5px] border-r-[5px]')} aria-hidden />
      <span className={cn(base, 'bottom-3 left-3 rounded-bl-xl border-b-[5px] border-l-[5px]')} aria-hidden />
      <span className={cn(base, 'right-3 bottom-3 rounded-br-xl border-r-[5px] border-b-[5px]')} aria-hidden />
    </>
  )
}
