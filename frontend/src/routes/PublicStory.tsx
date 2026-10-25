import { useQuery } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router'
import { StoryView } from '@/components/story/StoryView'
import { api } from '@/lib/api'

export function PublicStory() {
  const { heirloomId } = useParams() as { heirloomId: string }
  const [search] = useSearchParams()
  const story = useQuery({
    queryKey: ['public-story', heirloomId],
    queryFn: async () =>
      (await api.GET('/api/public/stories/{heirloom_id}', {
        params: { path: { heirloom_id: heirloomId }, query: { k: search.get('k') ?? '' } },
      })).data,
  })

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <header className="mb-4 flex items-center gap-3">
        <Link to="/" className="rounded-lg border border-ink/20 bg-white px-3 py-2 text-sm">
          Home
        </Link>
        <h1 className="font-serif text-xl">Family story</h1>
      </header>
      {story.data ? <StoryView story={story.data} /> : <p className="text-muted">Loading…</p>}
    </main>
  )
}
