import { useQuery } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router'
import { ImmersiveButton } from '@/components/immersive/ImmersiveButton'
import { StorytimeSection } from '@/components/storytime/StorytimeSection'
import { StoryView } from '@/components/story/StoryView'
import { api } from '@/lib/api'
import { useImmersivePhotos } from '@/lib/immersive'

export function PublicStory() {
  const { heirloomId } = useParams() as { heirloomId: string }
  const [search] = useSearchParams()
  const k = search.get('k') ?? ''
  const story = useQuery({
    queryKey: ['public-story', heirloomId],
    queryFn: async () =>
      (await api.GET('/api/public/stories/{heirloom_id}', {
        params: { path: { heirloom_id: heirloomId }, query: { k } },
      })).data,
  })
  // Only finished worlds, and never a way to make one, from the shared link.
  const worlds = useImmersivePhotos(heirloomId, k)
  const walk = (mediaId: string) => {
    const photo = worlds.get(mediaId)
    return photo ? <ImmersiveButton photo={photo} heirloomId={heirloomId} publicKey={k} /> : null
  }
  const cover = [...worlds.values()].find((p) => p.is_cover)

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <header className="mb-4 flex items-center gap-3">
        <Link to="/" className="rounded-lg border border-ink/20 bg-white px-3 py-2 text-sm">
          Home
        </Link>
        <h1 className="font-serif text-xl">Family story</h1>
      </header>
      {cover && story.data?.photos[cover.media_id] && (
        <div className="relative mb-6">
          <img src={story.data.photos[cover.media_id]} className="w-full rounded-xl" />
          <div className="absolute inset-x-3 bottom-3">{walk(cover.media_id)}</div>
        </div>
      )}
      {story.data ? (
        <>
          <StorytimeSection heirloomId={heirloomId} publicKey={k} />
          <StoryView story={story.data} photoAction={walk} />
        </>
      ) : (
        <p className="text-muted">Loading…</p>
      )}
    </main>
  )
}
