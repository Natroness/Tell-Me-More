import { BookOpen, ExternalLink, Pause, Play, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ObjectPhoto } from '@/components/story/parts'
import { AudioPlayer, Avatar, Card, Chip, Disclosure, SourceTag } from '@/components/ui/chrome'
import type { Schemas } from '@/lib/api'
import { useDisplayMode } from '@/lib/displayMode'
import { cn } from '@/lib/utils'

type Story = Schemas['Story']
type Block = Story['blocks'][number]
type Sentence = Schemas['Sentence']
type Fact = Schemas['Fact']
type FactKind = Fact['kind']
type Segment = Schemas['ResolvedSegment']
type Link = { url: string; title: string; retrieved_at?: string }

/**
 * Screen 16. The storyteller's original recordings come first; the written story keeps family
 * words (solid underline, tap to hear that moment), photo observations (dashed), AI suggestions
 * (dotted, marked) and checked history (book, with sources) visibly apart.
 */
export function StoryView({
  story,
  coverUrl,
  children,
}: {
  story: Story
  coverUrl?: string | null
  /** Secondary extras (storytime video, 3d world, actions) shown below the story. */
  children?: ReactNode
}) {
  const { mode } = useDisplayMode()
  const root = useRef<HTMLElement>(null)
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState<Segment | null>(null)

  // One voice at a time: starting any player on the page pauses the others.
  useEffect(() => {
    const el = root.current
    if (!el) return
    const onPlay = (e: Event) => {
      el.querySelectorAll('audio, video').forEach((m) => {
        if (m !== e.target) (m as HTMLMediaElement).pause()
      })
    }
    el.addEventListener('play', onPlay, true)
    return () => el.removeEventListener('play', onPlay, true)
  }, [])

  function play(segmentId: string) {
    const seg = story.segments[segmentId]
    const a = audio.current
    if (!seg || !a) return
    if (playing?.id === seg.id && !a.paused) {
      a.pause()
      return
    }
    if (a.src !== seg.audio_url) a.src = seg.audio_url
    a.currentTime = seg.start_ms / 1000
    setPlaying(seg)
    void a.play().catch(() => a.paused && setPlaying(null))
  }

  const name = (id?: string | null) => (id ? story.people[id] : undefined)
  const teller = name(story.recordings[0]?.speaker_id) ?? name(firstNarrator(story))
  const photo = coverUrl ?? Object.values(story.photos)[0]
  const usedMemories = new Set(story.blocks.flatMap((b) => (b.type === 'memory' ? [b.memory_note_id] : [])))
  const extraMemories = Object.entries(story.memories).filter(([id, text]) => !usedMemories.has(id) && text.trim())
  const body = mode === 'extra_simple' ? 'text-[1.45rem]' : 'text-[1.25rem]'

  function segmentFor(s: Sentence): string | undefined {
    const direct = s.cites.find((c) => c.kind === 'segment')
    if (direct) return direct.segment_id
    for (const c of s.cites) {
      if (c.kind !== 'fact') continue
      const src = story.facts[c.fact_id]?.source
      const id = src?.kind === 'memory' ? src.segment_ids?.find((sid) => story.segments[sid]) : undefined
      if (id) return id
    }
  }

  function kindOf(s: Sentence): FactKind {
    if (s.cites.some((c) => c.kind === 'segment')) return 'memory'
    const kinds = s.cites.flatMap((c) => (c.kind === 'fact' ? [story.facts[c.fact_id]?.kind] : []))
    return kinds.find((k) => k === 'memory') ?? kinds.find((k) => k && k !== 'inference') ?? 'inference'
  }

  function renderSentence(s: Sentence, i: number) {
    const kind = kindOf(s)
    const seg = kind === 'memory' ? segmentFor(s) : undefined
    const active = seg != null && playing?.id === seg
    if (seg)
      return (
        <span key={i}>
          <button
            type="button"
            onClick={() => play(seg)}
            className={cn(
              'inline cursor-pointer text-left underline decoration-ink decoration-solid decoration-2 underline-offset-[5px] hover:bg-sun/40',
              active && 'bg-sun text-black',
            )}
          >
            {s.text}
          </button>{' '}
        </span>
      )
    return (
      <span key={i}>
        <span
          className={cn(
            kind === 'memory' && 'underline decoration-ink decoration-solid decoration-2 underline-offset-[5px]',
            kind === 'observation' && 'underline decoration-ink/60 decoration-dashed decoration-[1.5px] underline-offset-[5px]',
            kind === 'inference' && 'underline decoration-muted decoration-dotted decoration-2 underline-offset-[5px]',
          )}
        >
          {s.text}
        </span>
        {kind === 'inference' && (
          <Sparkles className="ml-0.5 inline size-3.5 align-super text-muted" aria-label="ai suggestion" role="img" />
        )}
        {kind === 'history' && (
          <BookOpen className="ml-0.5 inline size-3.5 align-super" aria-label="history" role="img" />
        )}{' '}
      </span>
    )
  }

  function renderBlock(b: Block, i: number) {
    switch (b.type) {
      case 'heading':
        return (
          <h3 key={i} className="mt-4 font-hand text-[1.8rem] leading-tight break-words">
            {b.text}
          </h3>
        )
      case 'paragraph':
        return (
          <p key={i} className={cn('font-sans leading-relaxed break-words', body)}>
            {b.sentences.map(renderSentence)}
          </p>
        )
      case 'quote': {
        const seg = story.segments[b.segment_id]
        if (!seg) return null
        const who = name(b.speaker_id)
        return (
          <figure key={i} className="flex flex-col gap-1 border-l-4 border-sun pl-4">
            <button
              type="button"
              onClick={() => play(b.segment_id)}
              className={cn(
                'text-left font-hand text-[1.6rem] leading-snug break-words',
                playing?.id === seg.id && 'bg-sun text-black',
              )}
            >
              “{seg.text}”
            </button>
            {seg.text_en && seg.text_en !== seg.text && (
              <p className="font-sans text-[1.1rem] leading-snug break-words text-muted">“{seg.text_en}”</p>
            )}
            <figcaption className="flex items-center gap-2 font-sans text-[1rem] text-muted">
              <Play className="size-3.5" fill="currentColor" aria-hidden />
              {who ? `${who}, in their own voice` : 'in their own voice'}
            </figcaption>
          </figure>
        )
      }
      case 'context': {
        const cards = b.card_ids.flatMap((id) => (story.context_cards[id] ? [story.context_cards[id]] : []))
        if (cards.length === 0) return null
        return (
          <Disclosure
            key={i}
            summary={
              <span className="flex items-center gap-2">
                <BookOpen className="size-5 shrink-0" strokeWidth={2.2} aria-hidden />
                historical context
              </span>
            }
          >
            <div className="flex flex-col gap-4">
              {cards.map((card) => (
                <ContextCardView key={card.id} card={card} />
              ))}
            </div>
          </Disclosure>
        )
      }
      case 'timeline':
        if (b.events.length === 0) return null
        return (
          <ol key={i} className="flex flex-col gap-3 border-l-2 border-ink pl-5">
            {b.events.map((e) => {
              const kind = story.facts[e.fact_id]?.kind
              return (
                <li key={e.fact_id} className="relative font-sans text-[1.15rem] leading-snug break-words">
                  <span className="absolute top-1.5 -left-[1.72rem] size-3 rounded-full border-2 border-ink bg-sun" aria-hidden />
                  <span className="font-hand text-[1.3rem]">{e.year}</span>{' '}
                  <span className={cn(kind === 'inference' && 'underline decoration-muted decoration-dotted underline-offset-4')}>
                    {e.label}
                  </span>
                  {kind && kind !== 'memory' && (
                    <span className="ml-2 align-middle">
                      <SourceTag kind={kind} />
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
        )
      case 'photo': {
        const src = story.photos[b.media_id]
        if (!src) return null
        return (
          <figure key={i} className="flex flex-col gap-2">
            <div className="hand-box overflow-hidden border-2 border-ink">
              <img src={src} alt={b.caption?.text ?? ''} className="w-full object-cover" />
            </div>
            {b.caption && (
              <figcaption className="font-sans text-[1.1rem] leading-snug break-words text-muted">
                {renderSentence(b.caption, 0)}
              </figcaption>
            )}
          </figure>
        )
      }
      case 'people': {
        const names = b.person_ids.flatMap((id) => (story.people[id] ? [{ id, name: story.people[id] }] : []))
        if (names.length === 0) return null
        return (
          <section key={i} className="flex flex-col gap-2">
            <p className="font-sans text-[1.1rem] text-muted">people in this story</p>
            <ul className="flex flex-wrap gap-4">
              {names.map((p) => (
                <li key={p.id} className="flex w-20 flex-col items-center gap-1 text-center">
                  <Avatar name={p.name} />
                  <span className="w-full font-sans text-[1rem] leading-tight break-words">{p.name}</span>
                </li>
              ))}
            </ul>
          </section>
        )
      }
      case 'memory': {
        const text = story.memories[b.memory_note_id]
        if (!text) return null
        return <MemoryCard key={i} text={text} />
      }
    }
  }

  return (
    <article ref={root} className="flex flex-col gap-4">
      {photo && <ObjectPhoto src={photo} alt={story.title} />}
      <div className="flex flex-col gap-1">
        <h2 className="font-hand text-[2.3rem] leading-[1.05] break-words">{story.title}</h2>
        {teller && <p className="font-sans text-[1.25rem] text-muted">told by {teller}</p>}
      </div>

      {story.recordings.length > 0 && (
        <section className="flex flex-col gap-3" aria-label="original recordings">
          {story.recordings.map((r, idx) => (
            <div key={r.turn_id} className="flex flex-col gap-1">
              {story.recordings.length > 1 && r.question && (
                <p className="font-sans text-[1.05rem] leading-snug break-words text-muted">{r.question}</p>
              )}
              <AudioPlayer
                src={r.audio_url}
                durationMs={r.duration_ms}
                label={idx === 0 ? 'play the original recording' : 'play this answer'}
              />
            </div>
          ))}
          <div>
            <Chip tone="sun">original voice</Chip>
          </div>
        </section>
      )}

      <Transcript story={story} onPlay={play} playingId={playing?.id} />

      {story.dek && <p className={cn('font-sans leading-snug break-words text-muted', body)}>{story.dek}</p>}

      <Legend />
      <div className="flex flex-col gap-4">{story.blocks.map(renderBlock)}</div>

      {extraMemories.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="font-hand text-[1.7rem] leading-tight">memories from family</h3>
          {extraMemories.map(([id, text]) => (
            <MemoryCard key={id} text={text} />
          ))}
        </section>
      )}

      <Sources story={story} />

      {children}

      {playing && (
        <div className="sticky bottom-3 z-10">
          <Card className="flex items-center gap-3 bg-paper">
            <button
              type="button"
              onClick={() => audio.current?.pause()}
              aria-label="pause"
              className="grid size-12 shrink-0 place-items-center rounded-full border-2 border-ink bg-ink text-paper"
            >
              <Pause className="size-5" fill="currentColor" />
            </button>
            <p className="min-w-0 flex-1 font-sans text-[1.1rem] leading-snug break-words">
              {name(playing.speaker_id) ? `${name(playing.speaker_id)}'s own voice` : 'the original recording'}
            </p>
          </Card>
        </div>
      )}
      <audio
        ref={audio}
        preload="none"
        className="hidden"
        onPause={(e) => e.currentTarget.paused && setPlaying(null)}
        onEnded={() => setPlaying(null)}
        onTimeUpdate={(e) => {
          if (playing && e.currentTarget.currentTime * 1000 >= playing.end_ms) e.currentTarget.pause()
        }}
      />
    </article>
  )
}

function firstNarrator(story: Story) {
  for (const f of Object.values(story.facts)) if (f.source.kind === 'memory') return f.source.narrator_id
}

function Legend() {
  return (
    <Disclosure summary="how to read this story">
      <ul className="flex flex-col gap-2">
        <li>
          <span className="underline decoration-ink decoration-solid decoration-2 underline-offset-4">solid line</span> — the
          family's own words. tap to hear that moment.
        </li>
        <li>
          <span className="underline decoration-ink/60 decoration-dashed underline-offset-4">dashed line</span> — seen in the
          photo.
        </li>
        <li>
          <span className="underline decoration-muted decoration-dotted decoration-2 underline-offset-4">dotted line</span>{' '}
          <Sparkles className="inline size-3.5" aria-hidden /> — an ai suggestion, not something the family said.
        </li>
        <li>
          <BookOpen className="inline size-4" aria-hidden /> — history from checked sources.
        </li>
      </ul>
    </Disclosure>
  )
}

function MemoryCard({ text }: { text: string }) {
  return (
    <Card className="flex flex-col gap-2">
      <div>
        <SourceTag kind="memory" />
      </div>
      <p className="font-sans text-[1.2rem] leading-snug break-words">{text}</p>
    </Card>
  )
}

function ContextCardView({ card }: { card: Schemas['ContextCard'] }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="font-hand text-[1.35rem] leading-tight break-words">
        {card.topic} · {card.year}
        {card.place ? `, ${card.place}` : ''}
      </p>
      <p className="break-words">{card.summary}</p>
      <SourceLinks links={card.sources.flatMap(asLink)} />
    </div>
  )
}

function asLink(s: Record<string, unknown>): Link[] {
  return typeof s.url === 'string'
    ? [{ url: s.url, title: typeof s.title === 'string' && s.title ? s.title : hostOf(s.url), retrieved_at: typeof s.retrieved_at === 'string' ? s.retrieved_at : undefined }]
    : []
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'source'
  }
}

function SourceLinks({ links }: { links: Link[] }) {
  if (links.length === 0) return null
  return (
    <ul className="flex flex-col gap-1">
      {links.map((l, i) => (
        <li key={`${l.url}-${i}`} className="text-[1rem] leading-snug">
          <a href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1 break-all underline underline-offset-4">
            <ExternalLink className="mt-1 size-3.5 shrink-0" aria-hidden />
            <span className="break-words">{l.title}</span>
          </a>
          {l.retrieved_at && (
            <span className="text-muted"> · checked {new Date(l.retrieved_at).toLocaleDateString()}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

/** Every answer's words in order, each line playable from its moment in the recording. */
function Transcript({
  story,
  onPlay,
  playingId,
}: {
  story: Story
  onPlay: (segmentId: string) => void
  playingId?: string
}) {
  const segments = Object.values(story.segments)
  if (segments.length === 0) return null
  const byRecording = story.recordings.map((r) => ({
    r,
    lines: segments.filter((s) => s.audio_url === r.audio_url).sort((a, b) => a.start_ms - b.start_ms),
  }))
  const placed = new Set(byRecording.flatMap((g) => g.lines.map((s) => s.id)))
  const rest = segments.filter((s) => !placed.has(s.id)).sort((a, b) => a.start_ms - b.start_ms)
  const groups = rest.length ? [...byRecording, { r: null, lines: rest }] : byRecording

  return (
    <Disclosure summary="view transcript">
      <div className="flex flex-col gap-4">
        {groups.map((g, gi) =>
          g.lines.length === 0 ? null : (
            <div key={g.r?.turn_id ?? `rest-${gi}`} className="flex flex-col gap-1">
              {g.r?.question && <p className="text-[1.05rem] break-words text-muted">{g.r.question}</p>}
              <p className="leading-relaxed break-words">
                {g.lines.map((s) => (
                  <span key={s.id}>
                    <button
                      type="button"
                      onClick={() => onPlay(s.id)}
                      className={cn('inline text-left hover:bg-sun/40', playingId === s.id && 'bg-sun text-black')}
                    >
                      {s.text}
                    </button>{' '}
                  </span>
                ))}
              </p>
              {g.lines.some((s) => s.text_en && s.text_en !== s.text) && (
                <p className="text-[1.05rem] leading-snug break-words text-muted">
                  {g.lines.map((s) => s.text_en ?? s.text).join(' ')}
                </p>
              )}
            </div>
          ),
        )}
      </div>
    </Disclosure>
  )
}

/** Where history and photo lookups came from; AI suggestions say what they were based on. */
function Sources({ story }: { story: Story }) {
  const facts = Object.values(story.facts)
  const history = facts.filter((f) => f.source.kind === 'history')
  const looked = facts.filter((f) => f.source.kind === 'observation' && f.source.url)
  const cards = Object.values(story.context_cards)
  const guesses = facts.filter((f) => f.kind === 'inference')
  if (!history.length && !looked.length && !cards.length && !guesses.length) return null
  return (
    <Disclosure
      summary={
        <span className="flex items-center gap-2">
          <BookOpen className="size-5 shrink-0" strokeWidth={2.2} aria-hidden />
          sources
        </span>
      }
    >
      <div className="flex flex-col gap-5">
        {(history.length > 0 || cards.length > 0) && (
          <section className="flex flex-col gap-3">
            <SourceTag kind="history" />
            {history.map((f) => (
              <div key={f.id} className="flex flex-col gap-1">
                <p className="break-words">{f.text}</p>
                {f.source.kind === 'history' && <SourceLinks links={[f.source]} />}
              </div>
            ))}
            {cards.map((c) => (
              <ContextCardView key={c.id} card={c} />
            ))}
          </section>
        )}
        {looked.length > 0 && (
          <section className="flex flex-col gap-3">
            <SourceTag kind="observation" />
            {looked.map((f) => (
              <div key={f.id} className="flex flex-col gap-1">
                <p className="break-words">{f.text}</p>
                {f.source.kind === 'observation' && f.source.url && (
                  <SourceLinks links={[{ url: f.source.url, title: hostOf(f.source.url) }]} />
                )}
              </div>
            ))}
          </section>
        )}
        {guesses.length > 0 && (
          <section className="flex flex-col gap-3">
            <SourceTag kind="inference" />
            {guesses.map((f) => (
              <p key={f.id} className="break-words text-muted">
                {f.text}
                {f.source.kind === 'inference' && f.source.based_on.length > 0 && (
                  <span> · based on {f.source.based_on.length} {f.source.based_on.length === 1 ? 'detail' : 'details'}</span>
                )}
              </p>
            ))}
          </section>
        )}
      </div>
    </Disclosure>
  )
}
