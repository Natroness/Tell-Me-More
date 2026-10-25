import { useQueryClient } from '@tanstack/react-query'
import { Mic, Square } from 'lucide-react'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { AudioPlayer, Button, ErrorState, Header, HandLink, Loading, Notice, ScreenBody, TextButton } from '@/components/ui/chrome'
import { api } from '@/lib/api'
import { formatApiError } from '@/lib/apiError'
import { startRecording, type Recording } from '@/lib/recorder'
import { useScreenTitle } from '@/lib/useScreenTitle'
import { errorText, memoryKey, uploadToMemory, useMemory, type Memory } from './data'
import { PhotoStrip } from './parts'

const MAX_MS = 25 * 60 * 1000

/** Screen 26: tell what happened that day, in your own voice. */
export function RecordMemory() {
  useScreenTitle('record a memory')
  const { memoryId } = useParams() as { memoryId: string }
  const memory = useMemory(memoryId)
  if (memory.isLoading) return <ScreenBody><Header title="record a memory" back="/memories" /><Loading /></ScreenBody>
  if (memory.isError || !memory.data)
    return (
      <ScreenBody>
        <Header title="record a memory" back="/memories" />
        <ErrorState message={memory.error?.message} onRetry={() => memory.refetch()} />
      </ScreenBody>
    )
  return <Recorder memory={memory.data} />
}

function fmt(ms: number) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

type Phase = 'idle' | 'starting' | 'recording' | 'saving' | 'failed'

function Recorder({ memory }: { memory: Memory }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const id = memory.id
  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const rec = useRef<Recording | null>(null)
  const startedAt = useRef(0)
  const blob = useRef<Blob | null>(null)
  const pendingMedia = useRef<string | undefined>(undefined)

  useEffect(() => () => void rec.current?.stop(), [])

  const tick = useEffectEvent(() => {
    const ms = Date.now() - startedAt.current
    setElapsed(ms)
    setLevel(rec.current?.level() ?? 0)
    if (ms >= MAX_MS) void stop()
  })

  useEffect(() => {
    if (phase !== 'recording') return
    const t = setInterval(tick, 200)
    return () => clearInterval(t)
  }, [phase])

  async function discard(mediaId: string) {
    const { error, response } = await api.DELETE('/api/memories/{memory_id}/media/{media_id}', {
      params: { path: { memory_id: id, media_id: mediaId } },
    })
    if (error && response.status !== 404) throw new Error(formatApiError(error, 'we could not remove the old recording.'))
  }

  async function start() {
    setError(null)
    setPhase('starting')
    try {
      if (pendingMedia.current) {
        await discard(pendingMedia.current)
        pendingMedia.current = undefined
      }
      if (memory.recording) {
        await discard(memory.recording.id)
        await qc.invalidateQueries({ queryKey: memoryKey(id) })
      }
    } catch (e) {
      setError(errorText(e))
      setPhase('idle')
      return
    }
    try {
      rec.current = await startRecording()
      startedAt.current = Date.now()
      setElapsed(0)
      setPhase('recording')
    } catch {
      setError('we could not use the microphone. allow it in your browser settings and try again.')
      setPhase('idle')
    }
  }

  async function stop() {
    const r = rec.current
    if (!r) return
    rec.current = null
    setPhase('saving')
    blob.current = await r.stop()
    await save()
  }

  async function save() {
    if (!blob.current) return
    setPhase('saving')
    setError(null)
    try {
      const { memory: saved } = await uploadToMemory(id, 'audio', blob.current, {
        mediaId: pendingMedia.current,
        onMediaId: (m) => (pendingMedia.current = m),
      })
      qc.setQueryData(memoryKey(id), saved)
      qc.invalidateQueries({ queryKey: ['memories'] })
      navigate(`/memories/${id}/edit`)
    } catch (e) {
      setError(errorText(e, 'your recording did not save.'))
      setPhase('failed')
    }
  }

  const recording = phase === 'recording'
  const existing = memory.recording && phase === 'idle'
  const locked = memory.status === 'published'

  return (
    <ScreenBody screen="record-memory">
      <Header title="record a memory" back={`/memories/${id}/photos`} />
      <div className="flex flex-1 flex-col gap-5">
        <PhotoStrip photos={memory.photos} />
        <p className="text-center font-hand text-[1.9rem] leading-tight">what happened that day?</p>

        {existing ? (
          <div className="flex flex-col gap-4">
            <p className="font-sans text-[1.2rem] leading-snug">your recording</p>
            <AudioPlayer src={memory.recording!.url} label="play your recording" />
            {locked && <Notice>a shared memory keeps its original recording.</Notice>}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-2">
            <button
              type="button"
              onClick={recording ? () => void stop() : () => void start()}
              disabled={phase === 'starting' || phase === 'saving' || phase === 'failed'}
              aria-label={recording ? 'stop recording' : 'start recording'}
              className="grid size-36 place-items-center rounded-full border-[3px] border-ink bg-sun text-black transition disabled:opacity-60"
              style={recording ? { outline: `${4 + Math.min(16, level * 120)}px solid var(--color-sun)`, outlineOffset: 4 } : undefined}
            >
              {recording ? <Square className="size-12" fill="currentColor" /> : <Mic className="size-16" strokeWidth={2.2} />}
            </button>
            <p className="font-sans text-[1.5rem] tabular-nums" aria-live="polite">
              {phase === 'saving' ? 'saving your recording…' : fmt(elapsed)}
            </p>
          </div>
        )}

        {error && (
          <Notice tone="error" onRetry={phase === 'failed' ? () => void save() : undefined}>
            {error}
          </Notice>
        )}

        <div className="mt-auto flex flex-col gap-2 pt-2">
          {existing ? (
            <>
              <Button to={`/memories/${id}/edit`}>keep it</Button>
              {!locked && (
                <Button tone="secondary" onClick={() => void start()}>
                  record again
                </Button>
              )}
            </>
          ) : recording ? (
            <Button onClick={() => void stop()}>stop and save</Button>
          ) : phase === 'failed' ? (
            <TextButton onClick={() => void start()}>record again</TextButton>
          ) : (
            <Button onClick={() => void start()} disabled={phase !== 'idle'}>
              {phase === 'starting' ? 'getting ready…' : phase === 'saving' ? 'saving…' : 'start recording'}
            </Button>
          )}
          {!recording && phase !== 'saving' && <HandLink to={`/memories/${id}/edit`}>skip for now</HandLink>}
        </div>
      </div>
    </ScreenBody>
  )
}
