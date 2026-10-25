import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { openAnswerStream, type AnswerStream, type Reply } from '@/lib/answerStream'
import { api, putToSignedUrl, type Schemas } from '@/lib/api'
import { buzz, HAPTIC } from '@/lib/haptics'
import { useLiveQuery } from '@/lib/realtime'
import { startRecording, type Recording } from '@/lib/recorder'
import { speak, stopSpeaking, unlockSpeech } from '@/lib/speech'

// ready: waiting for the first tap, which lets the phone speak and listen.
type Phase = 'ready' | 'speaking' | 'listening' | 'thinking' | 'ended'
type Question = { id: string; text: string; number: number }

// Quiet this long after they've spoken ends the answer. Long enough for a thinking pause.
const END_SILENCE_MS = 2_000
const MAX_ANSWER_MS = 3 * 60_000
const CHECK_MS = 100
const CALIBRATE_MS = 400

/**
 * A spoken conversation: the phone reads each question aloud, listens, and the next question
 * arrives on the same connection the answer streamed over (backend/app/routers/answer_stream.py).
 * Built to be used at arm's length, hands free (DESIGN.md §5.7).
 */
export function Interview() {
  const { interviewId } = useParams() as { interviewId: string }
  const navigate = useNavigate()
  const path = { params: { path: { interview_id: interviewId } } }

  const [phase, setPhaseState] = useState<Phase>('ready')
  const phaseRef = useRef<Phase>('ready')
  const setPhase = (p: Phase) => {
    phaseRef.current = p
    setPhaseState(p)
  }
  const [asked, setAsked] = useState<Question | null>(null)
  const [caption, setCaption] = useState('')
  const [heardSpeech, setHeardSpeech] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  // Bumped whenever a question starts or the interview ends, so a voice that was cut off
  // doesn't then open the mic for a question nobody is on any more.
  const generation = useRef(0)
  const recording = useRef<Recording | null>(null)
  const stream = useRef<AnswerStream | null>(null)
  // An answer slot not yet spoken into, kept when they ask to hear the question again.
  const unused = useRef<Schemas['AnswerUpload'] | null>(null)
  const answer = useRef<Schemas['AnswerUpload'] | null>(null)
  const watch = useRef<number | null>(null)

  const interview = useQuery({
    queryKey: ['interview', interviewId],
    queryFn: async () => (await api.GET('/api/interviews/{interview_id}', path)).data,
  })
  const turns = useQuery({
    queryKey: ['turns', interviewId],
    queryFn: async () => (await api.GET('/api/interviews/{interview_id}/turns', path)).data ?? [],
  })
  useLiveQuery('interview', `id=eq.${interviewId}`, ['interview', interviewId])
  useLiveQuery('turn', `interview_id=eq.${interviewId}`, ['turns', interviewId])

  const language = interview.data?.language ?? 'en'
  const max = interview.data?.max_questions ?? 10
  const questions = (turns.data ?? []).filter((t) => t.role === 'question')
  const latest = questions.at(-1)
  const current: Question | null =
    asked ?? (latest ? { id: latest.id, text: latest.text ?? '', number: questions.length } : null)
  const over = interview.data?.state === 'wrapping_up' || interview.data?.state === 'done'

  const finish = useMutation({
    mutationFn: () => api.POST('/api/interviews/{interview_id}/finish', path),
  })

  async function ask(q: Question) {
    const mine = ++generation.current
    setAsked(q)
    setProblem(null)
    setPhase('speaking')
    await speak(q.text, language)
    if (generation.current !== mine || phaseRef.current !== 'speaking') return
    try {
      await listen()
    } catch {
      stopWatching()
      setProblem('The microphone didn’t start. Allow it for this site, then tap Start.')
      setPhase('ready')
    }
  }

  async function listen() {
    setCaption('')
    setHeardSpeech(false)
    setPhase('listening')
    const backlog: ArrayBuffer[] = []
    const reuse = unused.current
    unused.current = null
    const [rec, slot] = await Promise.all([
      startRecording((pcm) => (stream.current ? stream.current.send(pcm) : backlog.push(pcm))),
      reuse ??
        api
          .POST('/api/interviews/{interview_id}/answers', { ...path, body: { audio_mime: 'audio/wav' } })
          .then((r) => r.data!),
    ])
    if (phaseRef.current !== 'listening') {
      // Ended or replayed while the mic was opening.
      unused.current = slot
      void rec.stop()
      return
    }
    answer.current = slot
    stream.current = openAnswerStream(interviewId, slot.turn_id, setCaption)
    backlog.splice(0).forEach((pcm) => stream.current!.send(pcm))
    recording.current = rec
    watchForSilence(rec)
  }

  // They're done when, having spoken, they go quiet for END_SILENCE_MS. The first moments set
  // the room's noise floor so a fan or a TV doesn't count as talking.
  function watchForSilence(rec: Recording) {
    const startedAt = performance.now()
    let floor = 0
    let lastLoud = 0
    watch.current = window.setInterval(() => {
      const level = rec.loudest()
      const now = performance.now()
      if (now - startedAt < CALIBRATE_MS) {
        floor = Math.max(floor, level)
        return
      }
      const threshold = Math.min(0.05, Math.max(0.012, floor * 2.5))
      if (level > threshold) {
        if (!lastLoud) setHeardSpeech(true)
        lastLoud = now
      }
      const quiet = lastLoud > 0 && now - lastLoud > END_SILENCE_MS
      if (quiet || now - startedAt > MAX_ANSWER_MS) void finishAnswer()
    }, CHECK_MS)
  }

  function stopWatching() {
    if (watch.current != null) window.clearInterval(watch.current)
    watch.current = null
  }

  /** Saves the answer and returns what comes next, or null if the queue will deliver it. */
  async function submit(): Promise<Reply | null> {
    stopWatching()
    const rec = recording.current
    const live = stream.current
    const slot = answer.current
    recording.current = stream.current = answer.current = null
    if (!rec || !live || !slot) return null
    const wav = await rec.stop()
    try {
      return await live.end()
    } catch {
      live.abort()
      await putToSignedUrl(slot.upload_url, wav)
      await api.POST('/api/interviews/{interview_id}/answers/{turn_id}/complete', {
        params: { path: { interview_id: interviewId, turn_id: slot.turn_id } },
      })
      return null
    }
  }

  async function finishAnswer() {
    if (phaseRef.current !== 'listening') return
    buzz(HAPTIC.stop)
    setPhase('thinking')
    const reply = await submit()
    if ((phaseRef.current as Phase) !== 'thinking') return // they ended it meanwhile
    if (reply?.ended) return wrapUp()
    if (reply?.question) return ask(reply.question)
    // Otherwise the uploaded answer goes through the queue; the effect below picks it up.
  }

  async function wrapUp() {
    generation.current++
    stopWatching()
    setPhase('ended')
    await speak('Thank you. I will write your story now.', language)
    if (interview.data) navigate(`/h/${interview.data.heirloom_id}`)
  }

  // The next question arrived another way (uploaded answer, or another device). Speaking it is
  // the external effect; the state changes ride along on the next tick.
  const arrived =
    phase === 'thinking' && !over && latest && latest.id !== asked?.id
      ? { id: latest.id, text: latest.text ?? '', number: questions.length }
      : null
  const arrivedId = arrived?.id
  useEffect(() => {
    if (phase !== 'thinking' || (!over && !arrivedId)) return
    const next = arrived
    const t = window.setTimeout(() => void (next ? ask(next) : wrapUp()))
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the question, not its object
  }, [phase, over, arrivedId])

  // Leaving the screen stops the voice and the mic.
  useEffect(
    () => () => {
      stopSpeaking()
      stopWatching()
      void recording.current?.stop()
      stream.current?.abort()
    },
    [],
  )

  function begin() {
    buzz(HAPTIC.start)
    unlockSpeech() // inside the tap, so the phone may speak from now on
    if (current) void ask(current)
  }

  async function hearAgain() {
    if (!current) return
    if (phaseRef.current === 'listening') {
      stopWatching()
      setPhase('speaking')
      unused.current = answer.current
      answer.current = null
      stream.current?.abort()
      stream.current = null
      await recording.current?.stop()
      recording.current = null
    }
    void ask(current)
  }

  async function endNow() {
    const keep = phaseRef.current === 'listening' && heardSpeech
    generation.current++
    setPhase('ended')
    stopSpeaking()
    if (keep) {
      await submit() // keep what they just said
    } else {
      stopWatching()
      stream.current?.abort()
      stream.current = null
      await recording.current?.stop()
      recording.current = null
    }
    await finish.mutateAsync()
    if (interview.data) navigate(`/h/${interview.data.heirloom_id}`)
  }

  const status = {
    ready: 'Tap Start and the question will be read to you.',
    speaking: 'Listen…',
    listening: heardSpeech ? 'Listening. Pause when you’re done.' : 'Your turn. Just talk.',
    thinking: 'Thinking of the next question…',
    ended: 'Thank you.',
  }[phase]

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-between gap-8 px-6 py-6">
      <header className="flex items-center justify-between gap-3">
        <Link to="/" className="rounded-lg border border-ink/20 bg-white px-3 py-2 text-sm">
          Home
        </Link>
        {current && (
          <span className="text-sm text-muted">
            Question {current.number} of {max}
          </span>
        )}
      </header>

      <div className="flex flex-col gap-6">
        <p className="font-serif text-4xl leading-tight">
          {over && phase === 'ready' ? 'This interview is finished.' : current?.text}
        </p>
        <p aria-live="polite" className="text-lg text-muted">
          {problem ?? status}
        </p>
        {phase === 'listening' && caption && (
          <p className="font-serif text-xl leading-snug text-muted italic">{caption}</p>
        )}
      </div>

      <div className="flex flex-col items-center gap-4">
        {phase === 'ready' && !over && (
          <button
            onClick={begin}
            disabled={!current}
            className="size-32 rounded-full bg-ink text-xl text-paper disabled:opacity-40"
          >
            Start
          </button>
        )}
        {phase === 'listening' && (
          <button
            onClick={() => void finishAnswer()}
            className="size-32 animate-pulse rounded-full bg-red-700 text-xl text-paper"
          >
            I’m done
          </button>
        )}
        {(phase === 'speaking' || phase === 'thinking') && (
          <div className="flex size-32 items-center justify-center rounded-full bg-ink/10">
            <span className={`size-6 rounded-full bg-ink ${phase === 'speaking' ? 'animate-ping' : 'animate-pulse'}`} />
          </div>
        )}
        {(phase === 'speaking' || phase === 'listening') && (
          <button onClick={() => void hearAgain()} className="text-lg underline">
            Hear the question again
          </button>
        )}
        {phase !== 'ended' && !over && (
          <button onClick={() => void endNow()} className="text-muted underline">
            End interview
          </button>
        )}
        {over && phase === 'ready' && interview.data && (
          <Link to={`/h/${interview.data.heirloom_id}`} className="rounded-xl bg-ink px-6 py-4 text-paper">
            See the story
          </Link>
        )}
      </div>
    </main>
  )
}
