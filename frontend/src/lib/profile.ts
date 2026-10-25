import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatApiError } from '@/lib/apiError'
import { useAuth } from '@/lib/auth'
import { supabase, supabaseConfigured } from '@/lib/supabase'

export function profileKey(userId: string) {
  return ['profile', userId] as const
}

export function useProfile() {
  const { ready, session, devSession } = useAuth()
  return useQuery({
    queryKey: session ? profileKey(session.user.id) : ['profile', 'signed-out'],
    enabled: ready && !!session && (supabaseConfigured || !!devSession),
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error, response } = await api.GET('/api/profile')
      if (response.status === 401) {
        await supabase.auth.signOut()
        throw new Error('session expired. sign in again.')
      }
      if (response.status === 502 || response.status === 503 || response.status === 504) {
        throw new Error('we could not reach your account. please try again in a moment.')
      }
      if (error || !data) throw new Error(formatApiError(error, 'we could not load your account.'))
      return data
    },
  })
}
