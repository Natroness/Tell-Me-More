import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { MessageCircle, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import {
  AudioPlayer,
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormError,
  Header,
  Loading,
  ScreenBody,
  Tabs,
} from '@/components/ui/chrome'
import { TextField } from '@/components/ui/fields'
import { api, type Schemas } from '@/lib/api'
import { formatApiError } from '@/lib/apiError'
import { useFamily } from '@/lib/family'
import { useScreenTitle } from '@/lib/useScreenTitle'
import { isOpen, useRequestBoard } from '@/routes/capture/data'
import { ObjectThumb, RequestCard } from '@/routes/capture/shared'

type Tab = 'stories' | 'requests'

/** Screen 05: the family's objects and the story requests around them. */
export function Shelf() {
  useScreenTitle('object stories')
  const family = useFamily()
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'requests' ? 'requests' : 'stories'
  const board = useRequestBoard(family.data?.id)
  const archive = useQuery({
    queryKey: ['archive'],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/archive')
      if (error || !data) throw new Error(formatApiError(error, 'we could not load your stories.'))
      return data
    },
  })

  if (family.isLoading)
    return (
      <ScreenBody>
        <Header title="object stories" back="/" />
        <Loading />
      </ScreenBody>
    )
  if (family.isError)
    return (
      <ScreenBody>
        <Header title="object stories" back="/" />
        <ErrorState message={family.error.message} onRetry={() => family.refetch()} />
      </ScreenBody>
    )
  if (!family.data) return <CreateFamily />

  const waiting = (board.incoming.data ?? []).filter((r) => r.status === 'pending').length

  return (
    <ScreenBody screen="object-stories">
      <Header title="object stories" back="/" />
      <Tabs
        tabs={[
          { id: 'stories', label: 'stories' },
          { id: 'requests', label: 'requests', count: waiting },
        ]}
        value={tab}
        onChange={(t) => setParams(t === 'stories' ? {} : { tab: t }, { replace: true })}
      />
      {tab === 'stories' ? (
        <StoriesTab board={board} archive={archive} />
      ) : (
        <RequestsTab board={board} />
      )}
    </ScreenBody>
  )
}

type Board = ReturnType<typeof useRequestBoard>

function StoriesTab({
  board,
  archive,
}: {
  board: Board
  archive: UseQueryResult<Schemas['ArchiveStory'][]>
}) {
  const objects = board.heirlooms.data ?? []
  const stories = archive.data ?? []
  const storyOf = (id: string) => stories.find((s) => s.heirloom_id === id)
  const extra = stories.filter((s) => !objects.some((h) => h.id === s.heirloom_id))
  const open = [...(board.sent.data ?? []), ...(board.incoming.data ?? [])].filter((r) => isOpen(r.status))

  return (
    <div className="flex flex-col gap-4">
      <Button to="/capture">
        <Plus className="size-7" strokeWidth={2.4} /> capture an object
      </Button>
      {board.heirlooms.isLoading ? (
        <Loading label="finding your objects…" />
      ) : board.heirlooms.isError ? (
        <ErrorState message={board.heirlooms.error.message} onRetry={() => board.heirlooms.refetch()} />
      ) : objects.length === 0 && extra.length === 0 ? (
        <EmptyState title="no objects yet">
          photograph something your family treasures, then ask who knows its story.
        </EmptyState>
      ) : (
        <>
          {archive.isError && (
            <ErrorState message="we could not load who told each story." onRetry={() => archive.refetch()} />
          )}
          {objects.map((h) => (
            <ObjectCard
              key={h.id}
              id={h.id}
              title={h.title}
              cover={h.cover_url}
              story={storyOf(h.id)}
              requests={open.filter((r) => r.heirloom_id === h.id)}
            />
          ))}
          {extra.map((s) => (
            <ObjectCard
              key={s.heirloom_id}
              id={s.heirloom_id}
              title={s.object_title ?? s.title}
              cover={s.cover_url}
              story={s}
              requests={[]}
            />
          ))}
        </>
      )}
    </div>
  )
}

function ObjectCard({
  id,
  title,
  cover,
  story,
  requests,
}: {
  id: string
  title?: string | null
  cover?: string | null
  story?: Schemas['ArchiveStory']
  requests: Schemas['StoryRequest'][]
}) {
  const first = requests[0]
  return (
    <Card className="flex flex-col gap-3 p-3">
      <Link to={`/h/${id}`} className="flex items-center gap-3">
        <ObjectThumb src={cover} className="size-24" />
        <div className="min-w-0 flex-1">
          <p className="font-hand text-[1.6rem] leading-tight break-words">{title ?? 'new object'}</p>
          {story?.storyteller_name && (
            <p className="font-sans text-[1.15rem] leading-snug break-words text-muted">
              told by {story.storyteller_name}
            </p>
          )}
          {!story && !first && (
            <p className="font-sans text-[1.1rem] leading-snug text-muted">no story yet</p>
          )}
        </div>
      </Link>
      {story && <StoryAudio heirloomId={id} />}
      {first && (
        <Link
          to={`/requests/${first.id}`}
          className="hand-box flex items-start gap-2 border-2 border-dashed border-ink/60 px-3 py-2 font-sans text-[1.1rem] leading-snug"
        >
          <MessageCircle className="mt-0.5 size-5 shrink-0" strokeWidth={2.2} aria-hidden />
          <span className="min-w-0 break-words">
            {requests.length === 1 ? '1 pending request' : `${requests.length} pending requests`}
            {first.message && <span className="block text-muted">{first.message}</span>}
          </span>
        </Link>
      )}
    </Card>
  )
}

/** The storyteller's own first recording, when the story has one. */
function StoryAudio({ heirloomId }: { heirloomId: string }) {
  const story = useQuery({
    queryKey: ['story', heirloomId],
    queryFn: async () =>
      (await api.GET('/api/stories/{heirloom_id}', { params: { path: { heirloom_id: heirloomId } } })).data,
  })
  const rec = story.data?.recordings[0]
  if (!rec) return null
  return <AudioPlayer src={rec.audio_url} durationMs={rec.duration_ms} label="play their recording" />
}

function RequestsTab({ board }: { board: Board }) {
  const { sent, incoming, people, heirloomOf } = board
  if (sent.isLoading || incoming.isLoading) return <Loading label="loading requests…" />
  if (sent.isError || incoming.isError)
    return (
      <ErrorState
        onRetry={() => {
          sent.refetch()
          incoming.refetch()
        }}
      />
    )
  const forMe = incoming.data ?? []
  const mine = sent.data ?? []
  if (forMe.length === 0 && mine.length === 0)
    return (
      <EmptyState title="no requests yet" action={<Button to="/capture">capture an object</Button>}>
        capture an object and ask a relative to tell its story.
      </EmptyState>
    )
  return (
    <div className="flex flex-col gap-6">
      {forMe.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-hand text-[1.7rem] leading-none">asked of you</h2>
          {forMe.map((r) => (
            <RequestCard
              key={r.id}
              r={r}
              side="incoming"
              heirloom={heirloomOf(r.heirloom_id)}
              name={people.nameOf(r.listener_id)}
            />
          ))}
        </section>
      )}
      {mine.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-hand text-[1.7rem] leading-none">you asked</h2>
          {mine.map((r) => (
            <RequestCard
              key={r.id}
              r={r}
              side="sent"
              heirloom={heirloomOf(r.heirloom_id)}
              name={people.nameOf(r.storyteller_id)}
            />
          ))}
        </section>
      )}
    </div>
  )
}

function CreateFamily() {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [yourName, setYourName] = useState('')
  const create = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST('/api/families', { body: { name, your_name: yourName } })
      if (error) throw new Error(formatApiError(error, 'we could not create your family.'))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['families'] }),
  })

  return (
    <ScreenBody screen="create-family">
      <Header title="start your family" back="/" />
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate()
        }}
      >
        <TextField label="family name" value={name} onChange={setName} />
        <TextField label="your name" value={yourName} onChange={setYourName} autoComplete="given-name" />
        <FormError>{create.error?.message}</FormError>
        <Button type="submit" disabled={!name.trim() || !yourName.trim() || create.isPending}>
          {create.isPending ? 'creating…' : 'create'}
        </Button>
      </form>
    </ScreenBody>
  )
}
