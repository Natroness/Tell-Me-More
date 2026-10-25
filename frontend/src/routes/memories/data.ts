import { useQuery } from '@tanstack/react-query'
import { api, putToSignedUrl, type Schemas } from '@/lib/api'
import { formatApiError } from '@/lib/apiError'

export type Memory = Schemas['FamilyMemoryDetail']
export type MemorySummary = Schemas['FamilyMemorySummary']

export const MAX_PHOTOS = 20
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']

export const memoryKey = (id: string) => ['memory', id] as const

export const inputClass =
  'hand-box min-h-14 w-full border-[1.5px] border-ink/40 bg-paper px-4 font-sans text-[1.3rem] text-ink outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-sun'

export function useMemory(memoryId: string) {
  return useQuery({
    queryKey: memoryKey(memoryId),
    queryFn: async () => {
      const { data, error, response } = await api.GET('/api/memories/{memory_id}', {
        params: { path: { memory_id: memoryId } },
      })
      if (response.status === 404) throw new Error('this memory is not here anymore, or it is still a draft.')
      if (error || !data) throw new Error(formatApiError(error, 'we could not load this memory.'))
      return data
    },
  })
}

export function errorText(e: unknown, fallback = 'something went wrong. try again.') {
  return e instanceof Error && e.message ? e.message : fallback
}

/** Reserve a media row, PUT the bytes to storage, then let the backend verify and attach them. */
export async function uploadToMemory(
  memoryId: string,
  kind: 'photo' | 'audio',
  blob: Blob,
  opts: { mediaId?: string; onMediaId?: (id: string) => void } = {},
): Promise<{ mediaId: string; memory: Memory }> {
  const complete = async (mediaId: string) => {
    const { data, error } = await api.POST('/api/memories/{memory_id}/media/{media_id}/complete', {
      params: { path: { memory_id: memoryId, media_id: mediaId } },
    })
    if (error || !data) throw new Error(formatApiError(error, 'we could not save that upload.'))
    return { mediaId, memory: data }
  }

  let mediaId = opts.mediaId
  let url: string
  if (mediaId) {
    const { data, error, response } = await api.POST('/api/memories/{memory_id}/media/{media_id}/upload-url', {
      params: { path: { memory_id: memoryId, media_id: mediaId } },
    })
    if (response.status === 404) return complete(mediaId)
    if (error || !data) throw new Error(formatApiError(error, 'we could not restart that upload.'))
    url = data.upload_url
  } else {
    const { data, error } = await api.POST('/api/memories/{memory_id}/media', {
      params: { path: { memory_id: memoryId } },
      body: { kind, mime: blob.type, byte_size: blob.size },
    })
    if (error || !data) throw new Error(formatApiError(error, 'we could not start that upload.'))
    mediaId = data.media_id
    opts.onMediaId?.(mediaId)
    url = data.upload_url
  }
  try {
    await putToSignedUrl(url, blob)
  } catch {
    throw new Error('the upload did not finish. check your connection and try again.')
  }
  return complete(mediaId)
}

export function formatDate(date: string | null | undefined) {
  if (!date) return null
  const d = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  return d
    .toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    .toLowerCase()
}
