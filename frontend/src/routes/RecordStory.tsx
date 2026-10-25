import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router'
import { BigButton, ScreenHeader } from '@/components/ui/Screen'
import { api } from '@/lib/api'

/**
 * Brief §4 I–J. The storyteller sees who is asking and why, then tells the story through the
 * real interview: recorded audio, live captions, and AI follow-up questions one at a time.
 * Finishing the interview writes the story, completes this request and notifies the listener.
 */
export function RecordStory() {
  const { requestId } = useParams() as { requestId: string }
  const navigate = useNavigate()

  const detail = useQuery({
    queryKey: ['request', requestId],
    queryFn: async () =>
      (await api.GET('/api/requests/{request_id}', {
        params: { path: { request_id: requestId } },
      })).data,
  })
  const r = detail.data

  const start = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST('/api/interviews', {
        body: { heirloom_id: r!.heirloom_id, narrator_id: r!.storyteller_id, request_id: requestId },
      })
      if (error) throw new Error('could not start')
      return data!
    },
    onSuccess: (started) => navigate(`/interview/${started.interview.id}`),
  })

  const open = r?.status === 'pending' || r?.status === 'in_progress'

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
      <ScreenHeader title="Tell the story" />
      <p className="text-lg">
        {r ? `${r.listener_name} wants to hear about your ${r.heirloom_title ?? 'object'}.` : '…'}
      </p>
      {r?.heirloom_cover_url && <img src={r.heirloom_cover_url} className="rounded-xl" alt="" />}
      {r?.message && <p className="rounded-xl bg-white p-4 shadow">“{r.message}”</p>}
      {open ? (
        <>
          <p className="text-muted">
            Tap Answer and just talk. You will hear one question at a time, and your voice is kept
            with the story.
          </p>
          <BigButton onClick={() => start.mutate()} primary>
            {start.isPending ? 'Getting ready…' : 'Tell the story'}
          </BigButton>
          {start.isError && <p className="text-red-800">Could not start. Try again.</p>}
          <BigButton to="/requests">Later</BigButton>
        </>
      ) : (
        r && (
          <>
            <p className="font-serif text-2xl">This request is {r.status.replace('_', ' ')}.</p>
            <BigButton to={`/h/${r.heirloom_id}`} primary>
              Open the object
            </BigButton>
          </>
        )
      )}
    </main>
  )
}
