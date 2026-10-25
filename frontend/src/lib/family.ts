import { useQuery } from '@tanstack/react-query'
import { api } from './api'

/** The MVP assumes one family per account: the first one you joined. */
export function useFamily() {
  return useQuery({
    queryKey: ['families'],
    queryFn: async () => (await api.GET('/api/families')).data ?? [],
    select: (families) => families[0] ?? null,
  })
}
