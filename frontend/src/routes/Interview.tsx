import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Mic, Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { formatMs } from '@/components/story/draft'
import { LiveWaveform, Thumb } from '@/components/story/parts'
import {
  Button,
  Card,
  Disclosure,
  ErrorState,
  FormError,
  Header,
  Loading,
  Notice,
  ScreenBody,
  TextButton,
} from '@/components/ui/chrome'
import { openAnswerStream, type AnswerStream } from '@/lib/answerStream'
import { api, putToSignedUrl, type Schemas } from '@/lib/api'
import { formatApiError } from '@/lib/apiError'
import { useDisplayMode } from '@/lib/displayMode'
import { buzz, HAPTIC } from '@/lib/haptics'
import { useLiveQuery } from '@/lib/realtime'
import { startRecording, type Recording } from '@/lib/recorder'
import { speak, stopSpeaking, unlockSpeech } from '@/lib/speech'
import { useScreenTitle } from '@/lib/useScreenTitle'
import { cn } from '@/lib/utils'

export type InterviewState = { requestId?: string; asker?: string | null; message?: string }

/** Screen 14: one question at a time, recorded in the teller's own voice. */
export function Interview() {
  useScreenTitle('tell the story')
  const { interviewId } = useParams() as { interviewId: string }
  const navigate = useNavigate()
  const qc = useQueryClient()
  const startup = useRef(0)
  const from = (useLocation().state as InterviewState | null) ?? {}
  const { mode } = useDisplayMode()
  const recording = useRef<Recording | null>(null)
  const stream = useRef<AnswerStream | null>(null)
  const answer = useRef<Schemas['AnswerUpload'] | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [starting, setStarting] = useState(false)
  const [paused, setPaused] = useState(false)
  const [caption, setCaption] = useState('')
  const [micError, setMicError] = useState('')
  const [level, setLevel] = useState<(() => number) | undefined>()
  const elapsed = useElapsed(isRecording, paused)
  const path = { params: { path: { interview_id: interviewId } } }

  const interview = useQuery({
    queryKey: ['interview', interviewId],
    refetchInterval: (q) => q.state.data?.state === 'thinking' ? 3000 : false,
    queryFn: async () => {
      const { data, error } = await api.GET('/api/interviews/{interview_id}', path)
      if (error || !data) throw new Error(formatApiError(error, 'we could not open this interview.'))
      return data
    },
  })
  const turns = useQuery({
    queryKey: ['turns', interviewId],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/interviews/{interview_id}/turns', path)
      if (error || !data) throw new Error(formatApiError(error, 'we could not load the questions.'))
      return data
    },
    refetchInterval: (q) => interview.data?.state !== 'done' && interview.data?.state !== 'wrapping_up'
      && (interview.data?.state === 'thinking' || q.state.data?.at(-1)?.role === 'answer') ? 3000 : false,
  })
  const heirloomId = interview.data?.heirloom_id
  const heirloom = useQuery({
    queryKey: ['heirloom', heirloomId],
    enabled: !!heirloomId,
    queryFn: async () =>
      (await api.GET('/api/heirlooms/{heirloom_id}', { params: { path: { heirloom_id: heirloomId! } } })).data,
  })
  useLiveQuery('interview', `id=eq.${interviewId}`, ['interview', interviewId])
  useLiveQuery('turn', `interview_id=eq.${interviewId}`, ['turns', interviewId])

  // Read each question aloud with the phone's own voice. Unlocking happened in the
  // record tap, so later questions speak on their own; leaving stops the voice.
  const latestQuestion = (turns.data ?? []).findLast((t) => t.role === 'question')
  useEffect(() => {
    if (latestQuestion?.text) void speak(latestQuestion.text, interview.data?.language ?? 'en')
  }, [latestQuestion?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    startup.current += 1
    stopSpeaking()
    void recording.current?.stop()
    recording.current = null
    stream.current?.abort()
    stream.current = null
  }, [])

  // The transcript streams while they speak; if that fails, upload the recording instead.
  const submit = useMutation({
    mutationFn: async (wav: Blob) => {
      const upload = answer.current!
      const live = stream.current
      stream.current = null
      try {
        const reply = await live!.end()
        qc.setQueryData<Schemas['Turn'][]>(['turns', interviewId], (previous = []) => {
          let next = previous.map((t) => t.id === upload.turn_id ? { ...t, text: reply.text } : t)
          const lastIndex = Math.max(0, ...next.map((t) => t.idx))
          if (!next.some((t) => t.id === upload.turn_id)) {
            next = [...next, { id: upload.turn_id, idx: lastIndex + 1, role: 'answer', text: reply.text, target_slot: null }]
          }
          const question = reply.question
          if (question && !next.some((t) => t.id === question.id)) {
            next = [...next, { id: question.id, idx: Math.max(...next.map((t) => t.idx)) + 1, role: 'question', text: question.text, target_slot: null }]
          }
          return next
        })
        qc.setQueryData<Schemas['Interview']>(['interview', interviewId], (previous) => previous
          ? { ...previous, state: reply.ended ? 'wrapping_up' : reply.question ? 'asking' : 'thinking' }
          : previous)
      } catch {
        live?.abort()
        await putToSignedUrl(upload.upload_url, wav)
        const { error } = await api.POST('/api/interviews/{interview_id}/answers/{turn_id}/complete', {
          params: { path: { interview_id: interviewId, turn_id: upload.turn_id } },
        })
        if (error) throw new Error(formatApiError(error, "we couldn't save that answer. try again."))
        qc.setQueryData<Schemas['Interview']>(['interview', interviewId], (previous) => previous
          ? { ...previous, state: 'thinking' } : previous)
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['turns', interviewId] })
      void qc.invalidateQueries({ queryKey: ['interview', interviewId] })
    },
  })
  const shareUrl = () => {
    const q = new URLSearchParams()
    if (from.requestId) q.set('request', from.requestId)
    if (interview.data) q.set('narrator', interview.data.narrator_id)
    return `/share/${heirloomId}?${q}`
  }
  const finish = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST('/api/interviews/{interview_id}/finish', path)
      if (error) throw new Error(formatApiError(error, "we couldn't finish just now. try again."))
    },
    onSuccess: () => navigate(shareUrl()),
  })

  async function toggle() {
    if (!isRecording) {
      // Inside the tap, so the phone may speak and buzz from now on.
      buzz(HAPTIC.start)
      unlockSpeech()
      setCaption('')
      setMicError('')
      setStarting(true)
      stopSpeaking()
      const generation = ++startup.current
      const backlog: ArrayBuffer[] = []
      let cancelled = false
      try {
        const [started, created] = await Promise.all([
          startRecording((pcm) => (stream.current ? stream.current.send(pcm) : backlog.push(pcm))).then((started) => {
            if (cancelled || startup.current !== generation) {
              void started.stop()
              throw new Error('recording cancelled')
            }
            recording.current = started
            return started
          }),
          api.POST('/api/interviews/{interview_id}/answers', {
            ...path,
            body: { audio_mime: 'audio/wav' },
          }).then((created) => {
            if (!created.data) throw new Error(formatApiError(created.error, "we couldn't start recording. try again."))
            return created.data
          }),
        ])
        if (startup.current !== generation) return
        answer.current = created
        stream.current = openAnswerStream(interviewId, created.turn_id, setCaption)
        backlog.splice(0).forEach((pcm) => stream.current!.send(pcm))
        recording.current = started
        setLevel(() => started.level)
        setPaused(false)
        setIsRecording(true)
      } catch (e) {
        cancelled = true
        if (startup.current !== generation) return
        await recording.current?.stop().catch(() => undefined)
        recording.current = null
        if (startup.current !== generation) return
        setMicError(
          e instanceof DOMException
            ? "we couldn't use the microphone. allow it in your browser settings and try again."
            : e instanceof Error
              ? e.message
              : "we couldn't start recording. try again.",
        )
      } finally {
        if (startup.current === generation) setStarting(false)
      }
      return
    }
    const rec = recording.current
    if (!rec) return
    recording.current = null
    const wav = await rec.stop()
    buzz(HAPTIC.stop)
    stopSpeaking()
    setIsRecording(false)
    setPaused(false)
    submit.mutate(wav)
  }

  async function togglePause() {
    const rec = recording.current
    if (!rec) return
    if (paused) await rec.resume()
    else await rec.pause()
    setPaused(!paused)
  }

  if (interview.isLoading)
    return (
      <ScreenBody screen="record-story">
        <Header title="tell the story" />
        <Loading />
      </ScreenBody>
    )
  if (!interview.data)
    return (
      <ScreenBody screen="record-story">
        <Header title="tell the story" />
        <ErrorState message={interview.error?.message} onRetry={() => interview.refetch()} />
      </ScreenBody>
    )

  const iv = interview.data
  const all = turns.data ?? []
  const question = all.findLast((t) => t.role === 'question')
  const lastAnswer = all.findLast((t) => t.role === 'answer')
  const asked = all.filter((t) => t.role === 'question').length
  const answered = all.some((t) => t.role === 'answer' && t.text)
  const ended = iv.state === 'wrapping_up' || iv.state === 'done'
  const thinking = iv.state === 'thinking' || submit.isPending
  const earlier = all.filter((t) => thinking || ended || t.id !== question?.id)
  const working = submit.isPending
    ? 'saving what you said…'
    : iv.state === 'thinking'
      ? lastAnswer && !lastAnswer.text
        ? 'writing down what you said…'
        : 'thinking of the next question…'
      : null
  const cover = heirloom.data?.heirloom.cover_url

  return (
    <ScreenBody screen="record-story" className="gap-4">
      <Header title="tell the story" back={false} />

      {ended ? (
        <div className="flex flex-col gap-4">
          <Notice title={iv.state === 'done' ? 'your story is ready' : 'writing your story…'}>
            {iv.state === 'done'
              ? 'thank you for telling it.'
              : 'your recording is safe. we are putting your words together — this takes a minute.'}
          </Notice>
          <Button onClick={() => navigate(shareUrl())}>review and share →</Button>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-3">
            <Thumb src={cover} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {question && asked > 1 && (
                <p className="font-sans text-[1.05rem] text-muted">
                  question {asked} of up to {iv.max_questions ?? 10}
                </p>
              )}
              {asked <= 1 && from.asker && from.message && (
                <p className="font-sans text-[1.1rem] leading-snug break-words text-muted">
                  {from.asker} asked: “{from.message}”
                </p>
              )}
              <p
                className={cn(
                  'font-hand leading-tight break-words',
                  mode === 'extra_simple' ? 'text-[2.2rem]' : 'text-[1.9rem]',
                )}
                aria-live="polite"
              >
                {thinking ? working : (question?.text ?? 'tell us about this object')}
              </p>
            </div>
          </div>

          {thinking ? (
            <Loading label="one moment — no need to tap anything." className="py-6" />
          ) : (
            <Card className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <LiveWaveform level={level} active={isRecording && !paused} />
                <span className="shrink-0 font-sans text-[1.3rem] tabular-nums">{formatMs(elapsed)}</span>
              </div>
              {isRecording && (
                <p className="font-sans text-[1.05rem] text-muted">{paused ? 'paused' : 'recording…'}</p>
              )}
              {isRecording && caption && (
                <p className="font-sans text-[1.2rem] leading-snug break-words text-muted italic">{caption}</p>
              )}
            </Card>
          )}

          <FormError>{micError || submit.error?.message || finish.error?.message}</FormError>

          {!thinking && (
            <div className="flex items-center gap-4">
              {isRecording ? (
                <>
                  <button
                    type="button"
                    onClick={togglePause}
                    aria-label={paused ? 'resume recording' : 'pause recording'}
                    className="grid size-16 shrink-0 place-items-center rounded-full border-2 border-ink bg-paper"
                  >
                    {paused ? <Play className="ml-0.5 size-7" fill="currentColor" /> : <Pause className="size-7" fill="currentColor" />}
                  </button>
                  <Button onClick={toggle}>finish</Button>
                </>
              ) : (
                <Button onClick={toggle} disabled={starting}>
                  <Mic className="size-7" strokeWidth={2.2} aria-hidden />
                  {starting ? 'getting ready…' : answered ? 'answer this one' : 'start recording'}
                </Button>
              )}
            </div>
          )}

          {!isRecording && !thinking && answered && (
            <Button tone="secondary" onClick={() => finish.mutate()} disabled={finish.isPending}>
              {finish.isPending ? 'one moment…' : "that's everything →"}
            </Button>
          )}
          {!isRecording && !thinking && !answered && (
            <p className="text-center font-sans text-[1.1rem] leading-snug text-muted">
              tap start and just talk. we'll ask a follow-up question after each answer, and your voice is
              kept with the story.
            </p>
          )}
        </>
      )}

      {earlier.length > 0 && (
        <Disclosure summary="transcript" className="mt-2">
          <ol className="flex flex-col gap-3">
            {earlier.map((t) => (
              <li key={t.id} className="break-words">
                {t.role === 'question' ? (
                  <p className="text-muted">{t.text}</p>
                ) : (
                  <p>{t.text ?? <span className="text-muted italic">writing it down…</span>}</p>
                )}
              </li>
            ))}
          </ol>
        </Disclosure>
      )}
      {!ended && (
        <div className="mt-auto pt-4 text-center">
          <TextButton onClick={() => navigate(heirloomId ? `/h/${heirloomId}` : '/')}>continue later</TextButton>
        </div>
      )}
    </ScreenBody>
  )
}

/** Time spent recording this answer, not counting pauses. */
function useElapsed(recording: boolean, paused: boolean) {
  const [ms, setMs] = useState(0)
  const total = useRef(0)
  useEffect(() => {
    if (!recording) total.current = 0
  }, [recording])
  useEffect(() => {
    if (!recording || paused) return
    const start = performance.now()
    const base = total.current
    const tick = () => setMs(base + performance.now() - start)
    const first = setTimeout(tick, 0)
    const id = setInterval(tick, 250)
    return () => {
      total.current = base + performance.now() - start
      clearTimeout(first)
      clearInterval(id)
    }
  }, [recording, paused])
  return ms
}
