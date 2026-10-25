import { useQuery } from '@tanstack/react-query'
import { api, type Schemas } from './api'

/** The signed-in account and the name it goes by. */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.GET('/api/me')).data ?? null,
    staleTime: 5 * 60_000,
  })
}

export function firstName(me: Schemas['Account'] | null | undefined): string {
  return me?.display_name.trim().split(/\s+/)[0] ?? ''
}
