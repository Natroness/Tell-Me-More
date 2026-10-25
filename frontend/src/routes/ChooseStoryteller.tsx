import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Link } from 'react-router'
import { BigButton, ScreenHeader } from '@/components/ui/Screen'
import { api } from '@/lib/api'
import { useFamily } from '@/lib/family'

/** Brief §3E: large cards, preview + message + Send; invite fallback preserves capture. */
export function ChooseStoryteller() {
  const { heirloomId } = useParams() as { heirloomId: string }
  const navigate = useNavigate()
  const { data: family } = useFamily()
  const [selected, setSelected] = useState('')
  const [message, setMessage] = useState('')

  const detail = useQuery({
    queryKey: ['heirloom', heirloomId],
    queryFn: async () =>
      (await api.GET('/api/heirlooms/{heirloom_id}', {
        params: { path: { heirloom_id: heirloomId } },
      })).data,
  })
  const people = useQuery({
    queryKey: ['people', family?.id],
    enabled: !!family,
    queryFn: async () =>
      (await api.GET('/api/families/{family_id}/people', {
        params: { path: { family_id: family!.id } },
      })).data ?? [],
  })

  const send = useMutation({
    mutationFn: async () =>
      (await api.POST('/api/requests', {
        body: {
          heirloom_id: heirloomId,
          storyteller_id: selected,
          message: message || undefined,
          idempotency_key: crypto.randomUUID(),
        },
      })).data!,
    onSuccess: (r) => navigate(`/request-confirm/${r.id}`),
  })

  const others = (people.data ?? []).filter((p) => p.display_name)

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
      <ScreenHeader title="Choose storyteller" />
      <h1 className="font-serif text-3xl">Who might know its story?</h1>
      {detail.data?.heirloom.cover_url && (
        <img src={detail.data.heirloom.cover_url} className="rounded-xl" alt="Object" />
      )}
      {others.length === 0 ? (
        <>
          <p className="text-muted">
            No family members connected yet. Your capture is saved — invite someone first.
          </p>
          <BigButton to="/family" primary>
            Invite a family member
          </BigButton>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            {others.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelected(p.id)}
                className={`flex flex-col items-center gap-2 rounded-xl border p-4 ${
                  selected === p.id ? 'border-ink bg-white' : 'border-ink/20 bg-white/60'
                }`}
              >
                <span className="flex size-14 items-center justify-center rounded-full bg-ink/10 font-serif text-2xl">
                  {p.display_name.charAt(0)}
                </span>
                <span className="text-lg">{p.display_name}</span>
                {p.relation_label && <span className="text-sm text-muted">{p.relation_label}</span>}
              </button>
            ))}
          </div>
          {selected && (
            <>
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Grandpa, who gave you this watch?"
                className="rounded-lg border border-ink/20 bg-white px-4 py-3"
              />
              <BigButton onClick={() => send.mutate()} disabled={send.isPending} primary>
                {send.isPending ? 'Sending…' : 'Send request'}
              </BigButton>
            </>
          )}
          {send.isError && <p className="text-red-700">Couldn&apos;t send. Try again.</p>}
        </>
      )}
      <Link to="/family" className="text-sm text-muted underline">
        Manage family
      </Link>
    </main>
  )
}
