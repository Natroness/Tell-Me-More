import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import { formatApiError } from './apiError'

const families = {
  queryKey: ['families'],
  queryFn: async () => {
    const { data, error } = await api.GET('/api/families')
    if (error || !data) throw new Error(formatApiError(error, 'we could not load your family.'))
    return data
  },
}

/** Every family you belong to, the one you are looking at first. */
export function useFamilies() {
  return useQuery(families)
}

/**
 * The family every screen shows: the one you chose (or joined by accepting an invitation),
 * else the one you own. The server lists it first, so relatives share one view.
 */
export function useFamily() {
  return useQuery({ ...families, select: (list) => list[0] ?? null })
}

/** Switch the family every screen shows. Everything family-scoped refetches. */
export function useChooseFamily() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (familyId: string) => {
      const { data, error } = await api.PUT('/api/families/active', { body: { family_id: familyId } })
      if (error || !data) throw new Error(formatApiError(error, 'we could not switch families. try again.'))
      return data
    },
    onSuccess: () => qc.invalidateQueries(),
  })
}

export function useFamilyTree(familyId: string | undefined) {
  return useQuery({
    queryKey: ['tree', familyId],
    enabled: !!familyId,
    queryFn: async () => {
      const { data, error } = await api.GET('/api/families/{family_id}/tree', {
        params: { path: { family_id: familyId! } },
      })
      if (error || !data) throw new Error(formatApiError(error, 'we could not load your family tree.'))
      return data
    },
  })
}

export function useFamilyInvites(familyId: string | undefined) {
  return useQuery({
    queryKey: ['invites', familyId],
    enabled: !!familyId,
    queryFn: async () => {
      const { data, error } = await api.GET('/api/families/{family_id}/invites', {
        params: { path: { family_id: familyId! } },
      })
      if (error || !data) throw new Error(formatApiError(error, 'we could not load invitations.'))
      return data
    },
  })
}
