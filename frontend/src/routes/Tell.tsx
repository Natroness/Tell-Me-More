import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { BigButton, ScreenHeader } from '@/components/ui/Screen'
import { api } from '@/lib/api'
import { useFamily } from '@/lib/family'

/** Brief §3A "Tell a story": record without waiting for a request. */
export function Tell() {
  const { data: family } = useFamily()
  const navigate = useNavigate()
  const [heirloomId, setHeirloomId] = useState('')
  const [text, setText] = useState('')

  const heirlooms = useQuery({
    queryKey: ['heirlooms', family?.id],
    enabled: !!family,
    queryFn: async () =>
      (await api.GET('/api/heirlooms', { params: { query: { family_id: family!.id } } })).data ?? [],
  })

  const save = useMutation({
    mutationFn: async () =>
      (await api.POST('/api/heirlooms/{heirloom_id}/memories', {
        params: { path: { heirloom_id: heirloomId } },
        body: { text },
      })).data,
    onSuccess: () => navigate(`/h/${heirloomId}`),
  })

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
      <ScreenHeader title="Tell a story" />
      <p className="font-serif text-2xl">Tell us about this object.</p>
      <select
        value={heirloomId}
        onChange={(e) => setHeirloomId(e.target.value)}
        className="rounded-lg border border-ink/20 bg-white px-3 py-3"
      >
        <option value="">Which object?</option>
        {(heirlooms.data ?? []).map((h) => (
          <option key={h.id} value={h.id}>{h.title ?? 'Untitled object'}</option>
        ))}
      </select>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder="A memory in your own words — who, when, why it matters."
        className="rounded-lg border border-ink/20 bg-white px-4 py-3"
      />
      <BigButton onClick={() => save.mutate()} disabled={!heirloomId || !text.trim() || save.isPending} primary>
        {save.isPending ? 'Sharing…' : 'Share story'}
      </BigButton>
      <BigButton
        onClick={() => {
          if (heirloomId) localStorage.setItem(`tmm-draft-${heirloomId}`, text)
        }}
        disabled={!heirloomId || !text.trim()}
      >
        Save draft
      </BigButton>
      {save.isError && <p className="text-red-700">Couldn&apos;t share. Try again.</p>}
    </main>
  )
}
