import { useRef } from 'react'
import type { Schemas } from '@/lib/api'
import { cn } from '@/lib/utils'

type Story = Schemas['Story']
type Block = Story['blocks'][number]
type Sentence = Schemas['Sentence']
type FactKind = Schemas['Fact']['kind']

const KIND_STYLE: Record<FactKind, string> = {
  memory: 'decoration-memory',
  observation: 'decoration-observation',
  history: 'decoration-history',
  inference: 'decoration-inference decoration-dotted italic',
}

/** Renders a story; tapping a sentence that cites a recording plays it from that moment. */
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

  function play(segmentId: string) {
    const seg = story.segments[segmentId]
    if (!seg || !audio.current) return
    if (audio.current.src !== seg.audio_url) audio.current.src = seg.audio_url
    audio.current.currentTime = seg.start_ms / 1000
    void audio.current.play()
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
        onClick={seg ? () => play(seg.segment_id) : undefined}
        className={cn('underline decoration-2 underline-offset-4', KIND_STYLE[kindOf(s)], seg && 'cursor-pointer')}
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
            onClick={() => play(b.segment_id)}
            className="cursor-pointer border-l-4 border-memory pl-4 font-serif text-xl italic"
          >
            “{seg?.text_en ?? seg?.text}”
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
      // TODO: photo, people, memory blocks.
      case 'photo':
        return (
          <figure key={i} className="overflow-hidden rounded-xl bg-white shadow">
            <div className="flex aspect-video items-center justify-center bg-ink/5 text-sm text-muted">
              Photo {b.media_id.slice(0, 8)} — image plays in the heirloom page
            </div>
            {b.caption && (
              <figcaption className="p-3 text-sm">{b.caption.text}</figcaption>
            )}
          </figure>
        )
      case 'people':
        return (
          <section key={i} className="rounded-xl bg-white p-4 shadow">
            <p className="font-semibold">People in this story</p>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {b.person_ids.map((id) => (
                <li key={id}>{id.slice(0, 8)}</li>
              ))}
            </ul>
          </section>
        )
      case 'memory':
        return (
          <section key={i} className="rounded-xl border-l-4 border-memory bg-white p-4 text-sm shadow">
            <p className="font-semibold">A relative&apos;s addition</p>
            <p className="text-muted">Memory {b.memory_note_id.slice(0, 8)}</p>
          </section>
        )
    }
  }

  return (
    <article className="flex flex-col gap-4">
      <h1 className="font-serif text-4xl">{story.title}</h1>
      {storytellerName && <p className="text-muted">Told by {storytellerName}</p>}
      {story.dek && <p className="text-lg text-muted">{story.dek}</p>}
      <p className="rounded bg-ink/5 px-2 py-1 text-xs text-muted">
        Tap an underlined sentence to hear the original recording. Dotted lines are
        Tell Me More&apos;s notes, kept separate from family words.
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
      <audio ref={audio} controls className="sticky bottom-4 w-full" />
    </article>
  )
}
