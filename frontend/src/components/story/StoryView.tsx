import { useEffect, useRef, useState } from 'react'
import type { Schemas } from '@/lib/api'
import { cn } from '@/lib/utils'

type Story = Schemas['Story']
type Block = Story['blocks'][number]
type Sentence = Schemas['Sentence']
type FactKind = Schemas['Fact']['kind']

// What the player is doing: one tapped clip that stops at its end, or every answer in order.
type Mode = { kind: 'clip'; endMs: number } | { kind: 'all'; index: number } | null

const KIND_STYLE: Record<FactKind, string> = {
  memory: 'decoration-memory',
  observation: 'decoration-observation',
  history: 'decoration-history',
  inference: 'decoration-inference decoration-dotted italic',
}

function clock(ms: number) {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Renders a story you can listen to: the whole telling, or any sentence from its moment. */
export function StoryView({
  story,
  storytellerName,
  onFollowUp,
}: {
  story: Story
  storytellerName?: string
  onFollowUp?: () => void
}) {
  const audio = useRef<HTMLAudioElement>(null)
  const mode = useRef<Mode>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [atMs, setAtMs] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [question, setQuestion] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  const recordings = story.recordings
  const teller = storytellerName ?? (recordings[0] && story.people[recordings[0].speaker_id])
  const totalMs = recordings.reduce((sum, r) => sum + (r.duration_ms ?? 0), 0)
  const segments = Object.values(story.segments)
  const nowSegment = src
    ? segments.find((s) => s.audio_url === src && s.start_ms <= atMs && atMs < s.end_ms)
    : undefined

  useEffect(() => {
    // So the player's own Play button starts the telling instead of sitting empty.
    if (recordings[0] && audio.current && !audio.current.src) load(recordings[0].audio_url)
  }, [recordings])

  function load(url: string) {
    const el = audio.current!
    if (el.dataset.src !== url) {
      el.src = url
      el.dataset.src = url
      setSrc(url)
    }
    return el
  }

  // iPhone Safari loads nothing before play() and allows play() only inside the tap itself,
  // so play first and seek once the clip's length is known.
  function start(el: HTMLAudioElement, fromMs: number) {
    setFailed(false)
    const seek = () => {
      el.currentTime = fromMs / 1000
    }
    if (el.readyState >= 1) seek()
    else el.addEventListener('loadedmetadata', seek, { once: true })
    el.play().catch(() => setFailed(true))
  }

  function playSegment(id: string) {
    const seg = story.segments[id]
    if (!seg || !audio.current) return
    mode.current = { kind: 'clip', endMs: seg.end_ms }
    setQuestion(null)
    start(load(seg.audio_url), seg.start_ms)
  }

  function playAll(index: number) {
    const rec = recordings[index]
    if (!rec || !audio.current) {
      mode.current = null
      setQuestion(null)
      return
    }
    mode.current = { kind: 'all', index }
    setQuestion(rec.question ?? null)
    start(load(rec.audio_url), 0)
  }

  function onTimeUpdate() {
    const el = audio.current!
    const ms = el.currentTime * 1000
    setAtMs(ms)
    if (mode.current?.kind === 'clip' && ms >= mode.current.endMs) {
      el.pause()
      mode.current = null
    }
  }

  function onPlay() {
    setPlaying(true)
    if (mode.current) return
    // Started from the player's own controls: carry on through the telling from here.
    const index = recordings.findIndex((r) => r.audio_url === audio.current?.dataset.src)
    if (index >= 0) {
      mode.current = { kind: 'all', index }
      setQuestion(recordings[index].question ?? null)
    }
  }

  function onEnded() {
    setPlaying(false)
    if (mode.current?.kind === 'all') playAll(mode.current.index + 1)
    else mode.current = null
  }

  function kindOf(s: Sentence): FactKind {
    if (s.cites.some((c) => c.kind === 'segment')) return 'memory'
    const kinds = s.cites.flatMap((c) => (c.kind === 'fact' ? [story.facts[c.fact_id]?.kind] : []))
    return kinds.find((k) => k && k !== 'inference') ?? 'inference'
  }

  function renderSentence(s: Sentence, i: number) {
    const seg = s.cites.find((c) => c.kind === 'segment')
    return (
      <span
        key={i}
        onClick={seg ? () => playSegment(seg.segment_id) : undefined}
        className={cn(
          'underline decoration-2 underline-offset-4',
          KIND_STYLE[kindOf(s)],
          seg && 'cursor-pointer',
          seg && nowSegment && seg.segment_id === nowSegment.id && 'bg-memory/15',
        )}
      >
        {s.text}{' '}
      </span>
    )
  }

  function renderBlock(b: Block, i: number) {
    switch (b.type) {
      case 'heading':
        return <h2 key={i} className="mt-8 font-serif text-2xl">{b.text}</h2>
      case 'paragraph':
        return <p key={i} className="leading-relaxed">{b.sentences.map(renderSentence)}</p>
      case 'quote': {
        const seg = story.segments[b.segment_id]
        return (
          <blockquote
            key={i}
            onClick={() => playSegment(b.segment_id)}
            className={cn(
              'cursor-pointer border-l-4 border-memory pl-4 font-serif text-xl italic',
              nowSegment?.id === b.segment_id && 'bg-memory/15',
            )}
          >
            “{seg?.text_en ?? seg?.text}”
            {story.people[b.speaker_id] && (
              <span className="mt-1 block text-sm not-italic text-muted">
                {story.people[b.speaker_id]} · tap to hear
              </span>
            )}
          </blockquote>
        )
      }
      case 'context':
        return (
          <aside key={i} className="grid gap-3">
            {b.card_ids.map((id) => {
              const card = story.context_cards[id]
              if (!card) return null
              return (
                <div key={id} className="rounded-lg border-l-4 border-history bg-white p-4 text-sm">
                  <p className="font-semibold">{card.year}{card.place && `, ${card.place}`}</p>
                  <p>{card.summary}</p>
                </div>
              )
            })}
          </aside>
        )
      case 'timeline':
        return (
          <ol key={i} className="border-l border-ink/20 pl-4">
            {b.events.map((e) => (
              <li key={e.fact_id}><span className="font-semibold">{e.year}</span> {e.label}</li>
            ))}
          </ol>
        )
      case 'photo': {
        const url = story.photos[b.media_id]
        if (!url) return null
        return (
          <figure key={i} className="overflow-hidden rounded-xl bg-white shadow">
            <img src={url} alt={b.caption?.text ?? ''} className="w-full object-cover" />
            {b.caption && <figcaption className="p-3 text-sm">{b.caption.text}</figcaption>}
          </figure>
        )
      }
      case 'people': {
        const names = b.person_ids.map((id) => story.people[id]).filter(Boolean)
        if (names.length === 0) return null
        return (
          <section key={i} className="rounded-xl bg-white p-4 shadow">
            <p className="font-semibold">People in this story</p>
            <p className="mt-1 text-sm">{names.join(', ')}</p>
          </section>
        )
      }
      case 'memory': {
        const text = story.memories[b.memory_note_id]
        if (!text) return null
        return (
          <section key={i} className="rounded-xl border-l-4 border-memory bg-white p-4 shadow">
            <p className="text-sm font-semibold">A relative&apos;s addition</p>
            <p className="mt-1">{text}</p>
          </section>
        )
      }
    }
  }

  return (
    <article className="flex flex-col gap-4">
      <h1 className="font-serif text-4xl">{story.title}</h1>
      {teller && <p className="text-muted">Told by {teller}</p>}
      {story.dek && <p className="text-lg text-muted">{story.dek}</p>}
      {recordings.length > 0 && (
        <button
          onClick={() => (playing ? audio.current?.pause() : mode.current ? audio.current?.play() : playAll(0))}
          className="flex items-center justify-between gap-3 rounded-xl bg-ink px-5 py-4 text-left text-paper"
        >
          <span className="text-lg">
            {playing ? 'Pause' : `Listen to ${teller ?? 'the storyteller'} tell it`}
          </span>
          <span className="text-sm opacity-80">
            {recordings.length} {recordings.length === 1 ? 'answer' : 'answers'}
            {totalMs > 0 && ` · ${clock(totalMs)}`}
          </span>
        </button>
      )}
      <p className="rounded bg-ink/5 px-2 py-1 text-xs text-muted">
        Tap an underlined sentence to hear that moment. Dotted lines are Tell Me More&apos;s notes,
        kept separate from family words.
      </p>
      {story.blocks.map(renderBlock)}
      {onFollowUp && (
        <button
          onClick={onFollowUp}
          className="rounded-xl border border-ink/20 bg-white px-4 py-3"
        >
          Ask a follow-up
        </button>
      )}
      <div className="sticky bottom-4 flex flex-col gap-2 rounded-xl bg-paper/95 p-2 shadow backdrop-blur">
        {playing && (question || nowSegment) && (
          <div className="px-2 text-sm" aria-live="polite">
            {question && <p className="text-muted">Asked: {question}</p>}
            {nowSegment && <p>“{nowSegment.text_en ?? nowSegment.text}”</p>}
          </div>
        )}
        {failed && (
          <p className="px-2 text-sm text-red-900">
            That recording wouldn&apos;t play. Check your connection and tap it again.
          </p>
        )}
        <audio
          ref={audio}
          controls
          preload="none"
          onPlay={onPlay}
          onPause={() => setPlaying(false)}
          onEnded={onEnded}
          onTimeUpdate={onTimeUpdate}
          className="w-full"
        />
      </div>
    </article>
  )
}
