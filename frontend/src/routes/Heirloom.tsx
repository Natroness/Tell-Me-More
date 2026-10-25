import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ImmersiveButton } from '@/components/immersive/ImmersiveButton'
import { StorytimeSection } from '@/components/storytime/StorytimeSection'
import { StoryView } from '@/components/story/StoryView'
import { BottomNav } from '@/components/ui/Nav'
import { ScreenHeader } from '@/components/ui/Screen'
import { api } from '@/lib/api'
import { useImmersivePhotos } from '@/lib/immersive'
import { useLiveQuery } from '@/lib/realtime'

export function Heirloom() {
  const { heirloomId } = useParams() as { heirloomId: string }
  const navigate = useNavigate()
  const [narratorId, setNarratorId] = useState('')

  const detail = useQuery({
    queryKey: ['heirloom', heirloomId],
    queryFn: async () =>
      (await api.GET('/api/heirlooms/{heirloom_id}', {
        params: { path: { heirloom_id: heirloomId } },
      })).data,
  })
  const familyId = detail.data?.heirloom.family_id
  const people = useQuery({
    queryKey: ['people', familyId],
    enabled: !!familyId,
    queryFn: async () =>
      (await api.GET('/api/families/{family_id}/people', {
        params: { path: { family_id: familyId! } },
      })).data ?? [],
  })
  const story = useQuery({
    queryKey: ['story', heirloomId],
    enabled: detail.data?.latest_story_version != null,
    queryFn: async () =>
      (await api.GET('/api/stories/{heirloom_id}', {
        params: { path: { heirloom_id: heirloomId } },
      })).data,
  })
  useLiveQuery('job', `subject_id=eq.${heirloomId}`, ['heirloom', heirloomId])
  useLiveQuery('story', `heirloom_id=eq.${heirloomId}`, ['story', heirloomId])

  const start = useMutation({
    mutationFn: async () =>
      (await api.POST('/api/interviews', {
        body: { heirloom_id: heirloomId, narrator_id: narratorId },
      })).data!,
    onSuccess: (r) => navigate(`/interview/${r.interview.id}`),
  })

  const worlds = useImmersivePhotos(heirloomId)

  if (!detail.data) return null
  const { heirloom, observations, seed_questions } = detail.data
  // Worlds are made from a finished story, so the button waits for one.
  const photoAction = (mediaId: string) => {
    const photo = story.data && worlds.get(mediaId)
    return photo ? <ImmersiveButton photo={photo} heirloomId={heirloomId} /> : null
  }
  const cover = [...worlds.values()].find((p) => p.is_cover)

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <ScreenHeader title="Heirloom" />
      {heirloom.cover_url && (
        <div className="relative">
          <img src={heirloom.cover_url} className="w-full rounded-xl" />
          {cover && <div className="absolute inset-x-3 bottom-3">{photoAction(cover.media_id)}</div>}
        </div>
      )}
      {story.data ? (
        <>
          <StorytimeSection heirloomId={heirloomId} />
          <StoryView story={story.data} photoAction={photoAction} />
        </>
      ) : (
        <>
          <h1 className="font-serif text-3xl">{heirloom.title ?? 'Reading the object…'}</h1>
          <ul className="flex flex-wrap gap-2">
            {observations.map((o) => (
              <li key={o.id} className="rounded-full bg-observation/10 px-3 py-1 text-sm">{o.text}</li>
            ))}
          </ul>
          {seed_questions.length > 0 && (
            <ul className="list-disc pl-5 text-muted">
              {seed_questions.map((q) => <li key={q}>{q}</li>)}
            </ul>
          )}
          <div className="flex gap-2">
            <select
              value={narratorId}
              onChange={(e) => setNarratorId(e.target.value)}
              className="flex-1 rounded-lg border border-ink/20 bg-white px-3"
            >
              <option value="">Who is telling the story?</option>
              {people.data?.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
            </select>
            <button
              disabled={!narratorId || start.isPending}
              onClick={() => start.mutate()}
              className="rounded-lg bg-ink px-4 py-3 text-paper disabled:opacity-40"
            >
              Start interview
            </button>
          </div>
        </>
      )}
      <BottomNav />
    </main>
  )
}
