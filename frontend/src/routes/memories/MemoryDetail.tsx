import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useLocation, useParams } from 'react-router'
import { AudioPlayer, Button, ErrorState, Header, Loading, Notice, ScreenBody, SourceTag } from '@/components/ui/chrome'
import { useFamilyTree } from '@/lib/family'
import { useScreenTitle } from '@/lib/useScreenTitle'
import { cn } from '@/lib/utils'
import { formatDate, useMemory, type Memory } from './data'
import { DeleteMemory, PhotoThumb } from './parts'

/** Screen 28: one family memory, told in the contributor's own voice. */
export function MemoryDetail() {
  useScreenTitle('memory')
  const { memoryId } = useParams() as { memoryId: string }
  const notice = (useLocation().state as { notice?: string } | null)?.notice
  const memory = useMemory(memoryId)
  const tree = useFamilyTree(memory.data?.family_id)
  const m = memory.data

  if (memory.isLoading) return <ScreenBody><Header title="memory" back="/memories" /><Loading /></ScreenBody>
  if (memory.isError || !m)
    return (
      <ScreenBody>
        <Header title="memory" back="/memories" />
        <ErrorState message={memory.error?.message} onRetry={() => memory.refetch()} />
      </ScreenBody>
    )

  const draft = m.status === 'draft'
  const mine = draft || (!!tree.data?.me && tree.data.me === m.contributor_id)
  const when = formatDate(m.event_date)

  return (
    <ScreenBody screen="memory-detail">
      <Header title="memory" back="/memories" />
      <div className="flex flex-1 flex-col gap-4">
        {notice && <Notice tone="success">{notice}</Notice>}
        {draft && (
          <Notice title="draft">
            only you can see this until you publish it.
          </Notice>
        )}
        <Carousel photos={m.photos} />
        <div className="flex flex-col gap-1">
          <h2 className="font-hand text-[2.1rem] leading-tight break-words">{m.title ?? 'untitled memory'}</h2>
          <p className="flex flex-wrap items-center gap-2 font-sans text-[1.2rem] leading-snug text-muted">
            told by {mine ? 'you' : m.contributor_name}
            <SourceTag kind="memory" />
          </p>
          {when && <p className="font-sans text-[1.2rem] leading-snug">{when}</p>}
        </div>
        {m.recording ? (
          <AudioPlayer src={m.recording.url} label="play the original recording" />
        ) : (
          draft && <p className="font-sans text-[1.15rem] text-muted">no recording yet.</p>
        )}
        {m.description && <p className="font-sans text-[1.2rem] leading-snug break-words whitespace-pre-line">{m.description}</p>}
        {mine && (
          <div className="mt-auto flex flex-col gap-2 pt-4">
            <Button tone={draft ? 'primary' : 'secondary'} to={`/memories/${m.id}/edit`}>
              {draft ? 'keep editing' : 'edit'}
            </Button>
            <DeleteMemory memoryId={m.id} />
          </div>
        )}
      </div>
    </ScreenBody>
  )
}

function Carousel({ photos }: { photos: Memory['photos'] }) {
  const [i, setI] = useState(0)
  if (photos.length === 0) return <PhotoThumb className="aspect-[4/3] w-full" />
  const at = Math.min(i, photos.length - 1)
  const round = 'grid size-12 place-items-center rounded-full border-2 border-ink bg-paper disabled:opacity-40'
  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <PhotoThumb src={photos[at].url} className="aspect-[4/3] w-full" />
        {photos.length > 1 && (
          <>
            <button
              type="button"
              aria-label="previous photo"
              onClick={() => setI(at - 1)}
              disabled={at === 0}
              className={cn(round, 'absolute top-1/2 left-2 -translate-y-1/2')}
            >
              <ChevronLeft className="size-6" strokeWidth={2.4} />
            </button>
            <button
              type="button"
              aria-label="next photo"
              onClick={() => setI(at + 1)}
              disabled={at === photos.length - 1}
              className={cn(round, 'absolute top-1/2 right-2 -translate-y-1/2')}
            >
              <ChevronRight className="size-6" strokeWidth={2.4} />
            </button>
          </>
        )}
      </div>
      {photos.length > 1 && (
        <div className="flex justify-center gap-2" aria-label={`photo ${at + 1} of ${photos.length}`}>
          {photos.map((p, n) => (
            <span key={p.id} className={cn('size-3 rounded-full border-2 border-ink', n === at && 'bg-sun')} />
          ))}
        </div>
      )}
    </div>
  )
}
