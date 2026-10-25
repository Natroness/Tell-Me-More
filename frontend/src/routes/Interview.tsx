import { useMutation, useQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { api, putToSignedUrl } from '@/lib/api'
import { useLiveQuery } from '@/lib/realtime'
import { startRecording, type Recording } from '@/lib/recorder'

/** Large type, one question, one button. Built to be read at arm's length (DESIGN.md §5.7). */
export function Interview() {
  const { interviewId } = useParams() as { interviewId: string }
  const navigate = useNavigate()
  const recording = useRef<Recording | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const path = { params: { path: { interview_id: interviewId } } }

  const interview = useQuery({
    queryKey: ['interview', interviewId],
    queryFn: async () => (await api.GET('/api/interviews/{interview_id}', path)).data,
  })
  const turns = useQuery({
    queryKey: ['turns', interviewId],
    queryFn: async () => (await api.GET('/api/interviews/{interview_id}/turns', path)).data ?? [],
  })
  useLiveQuery('interview', `id=eq.${interviewId}`, ['interview', interviewId])
  useLiveQuery('turn', `interview_id=eq.${interviewId}`, ['turns', interviewId])

  const submit = useMutation({
    mutationFn: async (wav: Blob) => {
      const { data } = await api.POST('/api/interviews/{interview_id}/answers', {
        ...path,
        body: { audio_mime: 'audio/wav' },
      })
      await putToSignedUrl(data!.upload_url, wav)
      await api.POST('/api/interviews/{interview_id}/answers/{turn_id}/complete', {
        params: { path: { interview_id: interviewId, turn_id: data!.turn_id } },
      })
    },
  })
  const finish = useMutation({
    mutationFn: () => api.POST('/api/interviews/{interview_id}/finish', path),
    onSuccess: () => interview.data && navigate(`/h/${interview.data.heirloom_id}`),
  })

  async function toggle() {
    if (!isRecording) {
      recording.current = await startRecording()
      setIsRecording(true)
      return
    }
    const wav = await recording.current!.stop()
    setIsRecording(false)
    submit.mutate(wav)
  }

  const question = turns.data?.findLast((t) => t.role === 'question')
  const thinking = interview.data?.state === 'thinking' || submit.isPending

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-between gap-8 px-6 py-10">
      <p className="font-serif text-4xl leading-tight">
        {thinking ? 'Listening to what you said…' : question?.text}
      </p>
      <div className="flex flex-col items-center gap-4">
        <button
          onClick={toggle}
          disabled={thinking}
          className={`size-28 rounded-full text-lg text-paper disabled:opacity-40 ${isRecording ? 'animate-pulse bg-red-700' : 'bg-ink'}`}
        >
          {isRecording ? 'Done' : 'Answer'}
        </button>
        <button onClick={() => finish.mutate()} className="text-muted underline">
          Finish the story
        </button>
      </div>
    </main>
  )
}
