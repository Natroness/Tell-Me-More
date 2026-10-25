import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { api, putToSignedUrl } from '@/lib/api'
import { useFamily } from '@/lib/family'

export function Capture() {
  const { data: family } = useFamily()
  const navigate = useNavigate()

  const upload = useMutation({
    mutationFn: async (photo: File) => {
      const { data, error } = await api.POST('/api/heirlooms', {
        body: { family_id: family!.id, photo_mime: photo.type },
      })
      if (error) throw error
      await putToSignedUrl(data.upload_url, photo)
      await api.POST('/api/heirlooms/{heirloom_id}/photos/{media_id}/complete', {
        params: { path: { heirloom_id: data.heirloom_id, media_id: data.media_id } },
      })
      return data.heirloom_id
    },
    onSuccess: (heirloomId) => navigate(`/h/${heirloomId}`),
  })

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4 text-center">
      <h1 className="font-serif text-3xl">Photograph the heirloom</h1>
      <p className="text-muted">A ring, a watch, a letter, a recipe book. Get close to the details.</p>
      <label className="cursor-pointer rounded-xl bg-ink px-6 py-4 text-paper">
        {upload.isPending ? 'Uploading…' : 'Open camera'}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          disabled={!family || upload.isPending}
          onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])}
        />
      </label>
      {upload.isError && <p className="text-red-700">Upload failed. Try again.</p>}
    </main>
  )
}
