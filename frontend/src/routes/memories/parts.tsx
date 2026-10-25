import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ImageIcon } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Button, Notice, TextButton } from '@/components/ui/chrome'
import { api } from '@/lib/api'
import { formatApiError } from '@/lib/apiError'
import { cn } from '@/lib/utils'
import { memoryKey, type Memory } from './data'

export function PhotoThumb({ src, className }: { src?: string | null; className?: string }) {
  return (
    <span className={cn('hand-box grid shrink-0 place-items-center overflow-hidden border-2 border-ink bg-paper', className)}>
      {src ? (
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        <ImageIcon className="size-1/3 text-muted" strokeWidth={2} aria-hidden />
      )}
    </span>
  )
}

export function PhotoStrip({ photos }: { photos: Memory['photos'] }) {
  if (photos.length === 0) return null
  return (
    <div className="-mx-6 flex gap-2 overflow-x-auto px-6 pb-1">
      {photos.map((p) => (
        <PhotoThumb key={p.id} src={p.url} className="size-20" />
      ))}
    </div>
  )
}

/** Two-step delete; only the person who added the memory reaches this. */
export function DeleteMemory({ memoryId, label = 'delete memory' }: { memoryId: string; label?: string }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [asking, setAsking] = useState(false)
  const remove = useMutation({
    mutationFn: async () => {
      const { error, response } = await api.DELETE('/api/memories/{memory_id}', {
        params: { path: { memory_id: memoryId } },
      })
      if (error || !response.ok) throw new Error(formatApiError(error, 'we could not delete this memory.'))
    },
    onSuccess: () => {
      qc.removeQueries({ queryKey: memoryKey(memoryId) })
      qc.invalidateQueries({ queryKey: ['memories'] })
      navigate('/memories', { replace: true, state: { notice: 'memory deleted.' } })
    },
  })

  if (!asking) return <TextButton onClick={() => setAsking(true)}>{label}</TextButton>
  return (
    <Notice tone="error" title="delete this memory?">
      <p>its photos and recording will be removed for everyone.</p>
      {remove.isError && <p className="mt-2">{remove.error.message}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button tone="secondary" onClick={() => setAsking(false)} disabled={remove.isPending}>
          keep it
        </Button>
        <Button onClick={() => remove.mutate()} disabled={remove.isPending}>
          {remove.isPending ? 'deleting…' : 'delete'}
        </Button>
      </div>
    </Notice>
  )
}
