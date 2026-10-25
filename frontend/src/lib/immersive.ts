import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useLiveQuery } from '@/lib/realtime'

/**
 * Each story photo and its immersive world, or nothing while the feature is off (the backend
 * answers 404). With `publicKey`, only finished worlds, for the shared story link.
 */
export function useImmersivePhotos(heirloomId: string, publicKey?: string) {
  const key = ['immersive', heirloomId, publicKey ?? null]
  const photos = useQuery({
    queryKey: key,
    retry: false,
    queryFn: async () => {
      const r = publicKey
        ? await api.GET('/api/public/heirlooms/{heirloom_id}/immersive', {
            params: { path: { heirloom_id: heirloomId }, query: { k: publicKey } },
          })
        : await api.GET('/api/heirlooms/{heirloom_id}/immersive', {
            params: { path: { heirloom_id: heirloomId } },
          })
      return r.data ?? []
    },
    // Realtime only sees the world row. A job that dies first never touches it, so look again.
    refetchInterval: (q) =>
      q.state.data?.some((p) => p.world && p.world.status !== 'ready' && p.world.status !== 'failed')
        ? 20_000
        : false,
  })
  useLiveQuery('immersive_world', `heirloom_id=eq.${heirloomId}`, key)
  return new Map((photos.data ?? []).map((p) => [p.media_id, p]))
}
