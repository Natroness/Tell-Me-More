import { useQuery } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useParams } from 'react-router'
import { Avatar, Button, Card, Chip, ErrorState, Header, Loading, ScreenBody } from '@/components/ui/chrome'
import { api } from '@/lib/api'
import { formatApiError } from '@/lib/apiError'
import { useScreenTitle } from '@/lib/useScreenTitle'
import { statusWord } from '@/routes/capture/data'
import { ObjectThumb } from '@/routes/capture/shared'

/** Screen 12: shown only once the saved request loads back from the server. */
export function RequestConfirm() {
  useScreenTitle('story requested')
  const { requestId } = useParams() as { requestId: string }
  const detail = useQuery({
    queryKey: ['request', requestId],
    queryFn: async () => {
      const { data, error } = await api.GET('/api/requests/{request_id}', {
        params: { path: { request_id: requestId } },
      })
      if (error || !data) throw new Error(formatApiError(error, 'we could not find this request.'))
      return data
    },
  })
  const r = detail.data

  return (
    <ScreenBody screen="request-status">
      <Header title="request status" back="/" />
      {detail.isLoading ? (
        <Loading />
      ) : !r ? (
        <ErrorState message={detail.error?.message} onRetry={() => detail.refetch()} />
      ) : (
        <>
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <span className="grid size-28 place-items-center rounded-full border-[3px] border-ink bg-sun text-black">
              <Check className="size-16" strokeWidth={3} aria-hidden />
            </span>
            <p className="font-hand text-[2.2rem] leading-tight">story requested</p>
          </div>
          <Card className="flex items-center gap-3">
            <ObjectThumb src={r.heirloom_cover_url ?? r.capture_url} className="size-16" />
            <Avatar name={r.storyteller_name} />
            <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
              <span className="font-sans text-[1.25rem] leading-tight break-words">{r.storyteller_name ?? 'your relative'}</span>
              <Chip>{statusWord(r.status)}</Chip>
            </div>
          </Card>
          <p className="mt-4 text-center font-sans text-[1.2rem] leading-snug break-words">
            we asked {r.storyteller_name ?? 'them'} about {r.heirloom_title ?? 'this object'}. we'll let you know
            when they tell it.
          </p>
          <div className="mt-auto flex flex-col gap-3 pt-6">
            <Button to={`/requests/${r.id}`}>view request</Button>
            <Button tone="secondary" to="/">
              home
            </Button>
          </div>
        </>
      )}
    </ScreenBody>
  )
}
