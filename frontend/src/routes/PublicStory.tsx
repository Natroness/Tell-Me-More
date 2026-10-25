import { useQuery } from '@tanstack/react-query'
import { useParams, useSearchParams } from 'react-router'
import { ImmersiveSection, StorytimeSection } from '@/components/story/StoryExtras'
import { StoryView } from '@/components/story/StoryView'
import { EmptyState, ErrorState, Header, Loading, ScreenBody } from '@/components/ui/chrome'
import { api } from '@/lib/api'
import { formatApiError } from '@/lib/apiError'
import { useScreenTitle } from '@/lib/useScreenTitle'

/** Screen 16 for anyone holding the family's story link. */
export function PublicStory() {
  const { heirloomId } = useParams() as { heirloomId: string }
  const [search] = useSearchParams()
  const k = search.get('k') ?? ''
  const story = useQuery({
    queryKey: ['public-story', heirloomId, k],
    retry: false,
    queryFn: async () => {
      const { data, error, response } = await api.GET('/api/public/stories/{heirloom_id}', {
        params: { path: { heirloom_id: heirloomId }, query: { k } },
      })
      if (response.status === 404) return null
      if (error || !data) throw new Error(formatApiError(error, 'we could not load this story.'))
      return data
    },
  })
  useScreenTitle(story.data?.title ?? 'a family story')

  return (
    <ScreenBody screen="public-story">
      <Header title="a family story" back="/" />
      {story.isLoading ? (
        <Loading />
      ) : story.error ? (
        <ErrorState message={story.error.message} onRetry={() => story.refetch()} />
      ) : !story.data ? (
        <EmptyState title="this story isn't here">the link may be incomplete or out of date. ask the family for a new one.</EmptyState>
      ) : (
        <StoryView story={story.data}>
          <StorytimeSection heirloomId={heirloomId} publicKey={k} />
          <ImmersiveSection heirloomId={heirloomId} publicKey={k} />
        </StoryView>
      )}
      <p className="mt-8 text-center font-hand text-[1.6rem]">tell me more</p>
    </ScreenBody>
  )
}
