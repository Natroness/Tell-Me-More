import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatApiError } from '@/lib/apiError'

export const STATUS_WORD: Record<string, string> = {
  pending: 'pending',
  in_progress: 'accepted',
  completed: 'answered',
  declined: 'declined',
  cancelled: 'cancelled',
}

export const statusWord = (s: string) => STATUS_WORD[s] ?? 'pending'
export const isOpen = (s: string) => s === 'pending' || s === 'in_progress'

/** Account-backed family members; `me` is the caller's own person. */
export function usePeople(familyId: string | undefined) {
  const q = useQuery({
    queryKey: ['people', familyId],
    enabled: !!familyId,
    queryFn: async () => {
      const { data, error } = await api.GET('/api/families/{family_id}/people', {
        params: { path: { family_id: familyId! } },
      })
      if (error || !data) throw new Error(formatApiError(error, 'we could not load your family.'))
      return data
    },
  })
  const people = q.data ?? []
  return {
    ...q,
    people,
    me: people.find((p) => p.relation === 'you')?.id,
    nameOf: (id: string) => people.find((p) => p.id === id)?.display_name,
  }
}

export function useHeirlooms(familyId: string | undefined) {
  return useQuery({
    queryKey: ['heirlooms', familyId],
    enabled: !!familyId,
    queryFn: async () => {
      const { data, error } = await api.GET('/api/heirlooms', {
        params: { query: { family_id: familyId! } },
      })
      if (error || !data) throw new Error(formatApiError(error, 'we could not load your objects.'))
      return data
    },
  })
}

export function useRequests(familyId: string | undefined, scope: 'mine' | 'incoming') {
  return useQuery({
    queryKey: ['requests', familyId, scope],
    enabled: !!familyId,
    queryFn: async () => {
      const { data, error } = await api.GET('/api/requests', {
        params: { query: { family_id: familyId!, scope } },
      })
      if (error || !data) throw new Error(formatApiError(error, 'we could not load requests.'))
      return data
    },
  })
}

/** Sent + incoming request lists with the names and objects they point at. */
export function useRequestBoard(familyId: string | undefined) {
  const people = usePeople(familyId)
  const heirlooms = useHeirlooms(familyId)
  const sent = useRequests(familyId, 'mine')
  const incoming = useRequests(familyId, 'incoming')
  const heirloomOf = (id: string) => heirlooms.data?.find((h) => h.id === id)
  return { people, heirlooms, sent, incoming, heirloomOf }
}
