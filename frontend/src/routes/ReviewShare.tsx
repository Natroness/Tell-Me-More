import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { BigButton, ScreenHeader } from '@/components/ui/Screen'
import { api } from '@/lib/api'

/** Brief §4J: review playback (link), editable title/description, Share / Record again / Save draft. */
export function ReviewShare() {
  const { heirloomId } = useParams() as { heirloomId: string }
  const [search] = useSearchParams()
  const requestId = search.get('request')
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [saved, setSaved] = useState(false)

  const share = useMutation({
    mutationFn: async () => {
      if (description.trim()) {
        await api.POST('/api/heirlooms/{heirloom_id}/memories', {
          params: { path: { heirloom_id: heirloomId } },
          body: { text: `${title.trim()} — ${description.trim()}`.slice(0, 2000) },
        })
      }
      if (requestId) {
        try {
          await api.POST('/api/requests/{request_id}/accept', {
            params: { path: { request_id: requestId } },
          })
        } catch {
          /* already in_progress */
        }
      }
    },
    onSuccess: () => navigate(`/h/${heirloomId}`),
  })

  function saveDraft() {
    localStorage.setItem(
      `tmm-draft-${heirloomId}`,
      JSON.stringify({ title, description, requestId, at: Date.now() }),
    )
    setSaved(true)
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
      <ScreenHeader title="Review and share" />
      <p className="font-serif text-2xl">Check it before sharing.</p>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Object title (editable)"
        className="rounded-lg border border-ink/20 bg-white px-4 py-3"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        placeholder="A sentence or two about it (editable)"
        className="rounded-lg border border-ink/20 bg-white px-4 py-3"
      />
      <p className="text-sm text-muted">
        AI titles and descriptions are editable. We never invent family details.
      </p>
      <BigButton onClick={() => share.mutate()} disabled={share.isPending} primary>
        {share.isPending ? 'Sharing…' : 'Share story'}
      </BigButton>
      <BigButton to={requestId ? `/answer/${requestId}` : `/tell`}>Record again</BigButton>
      <BigButton onClick={saveDraft}>Save draft</BigButton>
      {saved && <p className="text-sm text-muted">Draft saved. Resume any time from here.</p>}
      {share.isError && <p className="text-red-700">Couldn&apos;t share. Try again.</p>}
    </main>
  )
}
