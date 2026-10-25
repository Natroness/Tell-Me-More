import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/lib/api'
import { useFamily } from '@/lib/family'

export function Family() {
  const qc = useQueryClient()
  const { data: family } = useFamily()
  const [name, setName] = useState('')
  const [relation, setRelation] = useState('')
  const people = useQuery({
    queryKey: ['people', family?.id],
    enabled: !!family,
    queryFn: async () =>
      (await api.GET('/api/families/{family_id}/people', {
        params: { path: { family_id: family!.id } },
      })).data ?? [],
  })
  const add = useMutation({
    mutationFn: () =>
      api.POST('/api/people', {
        body: { family_id: family!.id, display_name: name, relation_label: relation || null },
      }),
    onSuccess: () => {
      setName('')
      setRelation('')
      qc.invalidateQueries({ queryKey: ['people', family?.id] })
    },
  })

  if (!family) return null
  const inviteLink = `${location.origin}/?invite=${family.invite_code}`

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-8">
      <h1 className="font-serif text-3xl">{family.name}</h1>
      <p className="text-sm text-muted">Invite code: <code>{family.invite_code}</code> ({inviteLink})</p>
      <ul className="divide-y divide-ink/10">
        {people.data?.map((p) => (
          <li key={p.id} className="py-2">
            {p.display_name} {p.relation_label && <span className="text-muted">· {p.relation_label}</span>}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Nani)" className="flex-1 rounded-lg border border-ink/20 bg-white px-3 py-2" />
        <input value={relation} onChange={(e) => setRelation(e.target.value)} placeholder="Relation" className="w-32 rounded-lg border border-ink/20 bg-white px-3 py-2" />
        <button disabled={!name} onClick={() => add.mutate()} className="rounded-lg bg-ink px-4 text-paper disabled:opacity-40">Add</button>
      </div>
    </main>
  )
}
