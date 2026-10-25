import { useMutation, useQuery } from '@tanstack/react-query'
import { Mic } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ObjectPhoto } from '@/components/story/parts'
import { ImmersiveSection, StorytimeSection } from '@/components/story/StoryExtras'
import { StoryView } from '@/components/story/StoryView'
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
  SourceTag,
} from '@/components/ui/chrome'
import { api, type Schemas } from '@/lib/api'
import { formatApiError } from '@/lib/apiError'
import { useLiveQuery } from '@/lib/realtime'
import { useScreenTitle } from '@/lib/useScreenTitle'
import { usePeople } from '@/routes/capture/data'

/** Screen 16 once a story exists; before that, what we noticed and how to start telling it. */
export function Heirloom() {
  const { heirloomId } = useParams() as { heirloomId: string }
  const detail = useQuery({
    queryKey: ['heirloom', heirloomId],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/heirlooms/{heirloom_id}', {
        params: { path: { heirloom_id: heirloomId } },
      })
      if (error || !data) throw new Error(formatApiError(error, 'we could not open this object.'))
      return data
    },
  })
  const hasStory = detail.data?.latest_story_version != null
  const story = useQuery({
    queryKey: ['story', heirloomId],
    enabled: hasStory,
    queryFn: async () => {
      const { data, error } = await api.GET('/api/stories/{heirloom_id}', {
        params: { path: { heirloom_id: heirloomId } },
      })
      if (error || !data) throw new Error(formatApiError(error, 'we could not load the story.'))
      return data
    },
  })
  useLiveQuery('job', `subject_id=eq.${heirloomId}`, ['heirloom', heirloomId])
  useLiveQuery('story', `heirloom_id=eq.${heirloomId}`, ['story', heirloomId])
  useScreenTitle(story.data?.title ?? detail.data?.heirloom.title ?? 'the story')

  if (detail.isLoading || (hasStory && story.isLoading))
    return (
      <ScreenBody screen="story-player">
        <Header title="the story" />
        <Loading />
      </ScreenBody>
    )
  if (!detail.data || (hasStory && !story.data))
    return (
      <ScreenBody screen="story-player">
        <Header title="the story" />
        <ErrorState
          message={(detail.error ?? story.error)?.message}
          onRetry={() => (detail.error ? detail.refetch() : story.refetch())}
        />
      </ScreenBody>
    )

  const { heirloom } = detail.data
  if (!story.data) return <NoStoryYet detail={detail.data} />

  return (
    <ScreenBody screen="story-player">
      <Header title="the story" />
      <StoryView story={story.data} coverUrl={heirloom.cover_url}>
        <StoryActions heirloom={heirloom} />
        <StorytimeSection heirloomId={heirloomId} />
        <ImmersiveSection heirloomId={heirloomId} canCreate />
      </StoryView>
    </ScreenBody>
  )
}

function useStartInterview(heirloomId: string) {
  const navigate = useNavigate()
  return useMutation({
    mutationFn: async (narratorId: string) => {
      const { data, error } = await api.POST('/api/interviews', {
        body: { heirloom_id: heirloomId, narrator_id: narratorId },
      })
      if (error || !data) throw new Error(formatApiError(error, 'we could not start. try again.'))
      return data
    },
    onSuccess: (r) => navigate(`/interview/${r.interview.id}`),
  })
}

/** Telling it yourself, asking someone, or recording someone sitting with you. */
function TellingActions({ heirloom, primary }: { heirloom: Schemas['Heirloom']; primary: boolean }) {
  const { people, me } = usePeople(heirloom.family_id)
  const start = useStartInterview(heirloom.id)
  const [narratorId, setNarratorId] = useState('')
  const others = people.filter((p) => p.id !== me)
  return (
    <div className="flex flex-col gap-3">
      <Button tone={primary ? 'primary' : 'secondary'} onClick={() => me && start.mutate(me)} disabled={!me || start.isPending}>
        <Mic className="size-7" strokeWidth={2.2} aria-hidden />
        {start.isPending && start.variables === me ? 'getting ready…' : primary ? 'tell it yourself' : 'add to the story'}
      </Button>
      <Button tone="secondary" to={`/choose/${heirloom.id}`}>
        ask someone →
      </Button>
      {others.length > 0 && (
        <Disclosure summary="someone is here with me">
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span>who is telling the story?</span>
              <select
                value={narratorId}
                onChange={(e) => setNarratorId(e.target.value)}
                className="hand-box h-14 w-full border-[1.5px] border-ink/40 bg-paper px-4 font-sans text-[1.3rem] text-ink"
              >
                <option value="">choose a person</option>
                {others.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name}
                  </option>
                ))}
              </select>
            </label>
            <Button onClick={() => start.mutate(narratorId)} disabled={!narratorId || start.isPending}>
              {start.isPending && start.variables === narratorId ? 'getting ready…' : 'start recording'}
            </Button>
          </div>
        </Disclosure>
      )}
      <FormError>{start.error?.message}</FormError>
    </div>
  )
}

function StoryActions({ heirloom }: { heirloom: Schemas['Heirloom'] }) {
  return (
    <section className="flex flex-col gap-3 pt-2">
      <h3 className="font-hand text-[1.6rem] leading-tight">know more about it?</h3>
      <TellingActions heirloom={heirloom} primary={false} />
    </section>
  )
}

function NoStoryYet({ detail }: { detail: Schemas['HeirloomDetail'] }) {
  const { heirloom, observations, seed_questions } = detail
  const reading = !heirloom.title && observations.length === 0
  return (
    <ScreenBody screen="object-detail" className="gap-4">
      <Header title={heirloom.title ?? 'the object'} />
      <ObjectPhoto src={heirloom.cover_url} alt={heirloom.title ?? undefined} />
      {reading ? (
        <Notice title="looking closely at the photo…">this takes a few seconds. you can start telling the story now.</Notice>
      ) : (
        <Notice>no story yet. tell it, or ask someone who knows.</Notice>
      )}
      {observations.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="font-hand text-[1.6rem] leading-tight">what we noticed</h3>
          <ul className="flex flex-col gap-2">
            {observations.map((o) => (
              <li key={o.id}>
                <Card className="flex flex-col items-start gap-1.5 p-3">
                  <SourceTag kind={o.kind} />
                  <span className="font-sans text-[1.2rem] leading-snug break-words">{o.text}</span>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
      {seed_questions.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="font-hand text-[1.6rem] leading-tight">questions to ask</h3>
          <ul className="flex flex-col gap-1.5 font-sans text-[1.2rem] leading-snug">
            {seed_questions.map((q) => (
              <li key={q} className="break-words">
                “{q}”
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="mt-auto pt-2">
        <TellingActions heirloom={heirloom} primary />
      </div>
    </ScreenBody>
  )
}
