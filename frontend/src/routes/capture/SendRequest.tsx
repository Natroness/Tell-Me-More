import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { useId, useState } from 'react'
import { useNavigate } from 'react-router'
import { Avatar, Button, Card, FormError, Header, ScreenBody } from '@/components/ui/chrome'
import { api, type Schemas } from '@/lib/api'
import { formatApiError } from '@/lib/apiError'
import { cn } from '@/lib/utils'
import { ObjectThumb } from './shared'

/** Screen 11: object + chosen person, an editable question, send. */
export function SendRequest({
  heirloomId,
  detail,
  person,
  captureMediaId,
}: {
  heirloomId: string
  detail?: Schemas['HeirloomDetail']
  person: Schemas['Person']
  captureMediaId?: string
}) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const id = useId()
  const [edited, setEdited] = useState<string | null>(null)
  const [key] = useState(() => crypto.randomUUID())
  const seeds = detail?.seed_questions ?? []
  const message = edited ?? seeds[0] ?? ''
  const title = detail?.heirloom.title

  const send = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST('/api/requests', {
        body: {
          heirloom_id: heirloomId,
          storyteller_id: person.id,
          message: message.trim() || undefined,
          capture_media_id: captureMediaId,
          idempotency_key: key,
        },
      })
      if (error || !data) throw new Error(formatApiError(error, "we couldn't send it. try again."))
      return data
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['requests'] })
      navigate(`/request-confirm/${r.id}`, { replace: true })
    },
  })

  return (
    <ScreenBody screen="send-request">
      <Header title="send a request" />
      <Card className="flex items-center justify-around gap-3">
        <div className="flex min-w-0 flex-col items-center gap-1.5">
          <ObjectThumb src={detail?.heirloom.cover_url} />
          {title && <span className="text-center font-sans text-[1.1rem] leading-tight break-words">{title}</span>}
        </div>
        <ArrowRight className="size-7 shrink-0" strokeWidth={2.2} aria-hidden />
        <div className="flex min-w-0 flex-col items-center gap-1.5">
          <Avatar name={person.display_name} src={person.avatar_url} size="lg" />
          <span className="text-center font-sans text-[1.1rem] leading-tight break-words">{person.display_name}</span>
        </div>
      </Card>

      <label htmlFor={id} className="mt-5 font-sans text-[1.35rem] leading-none">
        what would you like to know?
      </label>
      <textarea
        id={id}
        value={message}
        onChange={(e) => setEdited(e.target.value)}
        rows={3}
        placeholder={`who gave you this ${title ?? 'object'}?`}
        className="hand-box mt-2 w-full resize-none border-[1.5px] border-ink/40 bg-paper px-4 py-3 font-sans text-[1.3rem] leading-snug text-ink outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-sun"
      />
      {seeds.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="font-sans text-[1.1rem] text-muted">or pick a suggested question</p>
          <div className="flex flex-wrap gap-2">
            {seeds.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setEdited(q)}
                aria-pressed={message === q}
                className={cn(
                  'rounded-2xl border-[1.5px] border-dashed border-ink/70 px-3 py-1.5 text-left font-sans text-[1.1rem] leading-snug break-words',
                  message === q && 'border-solid border-ink bg-sun text-black',
                )}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      <FormError>{send.error?.message}</FormError>
      <div className="mt-auto pt-6">
        <Button onClick={() => send.mutate()} disabled={send.isPending}>
          {send.isPending ? 'sending…' : 'send request →'}
        </Button>
      </div>
    </ScreenBody>
  )
}
