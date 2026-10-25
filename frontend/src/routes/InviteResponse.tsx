import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import {
  Avatar,
  Button,
  EmptyState,
  ErrorState,
  FormError,
  HandLink,
  Header,
  Loading,
  Notice,
  ScreenBody,
} from '@/components/ui/chrome'
import { api, type Schemas } from '@/lib/api'
import { formatApiError } from '@/lib/apiError'
import { useAuth } from '@/lib/auth'
import { useProfile } from '@/lib/profile'
import { kindLabel, possessive } from '@/lib/relations'
import { clearReturnTo, readReturnTo, rememberReturnTo } from '@/lib/returnTo'
import { useScreenTitle } from '@/lib/useScreenTitle'

class InviteLoadError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function InviteResponse() {
  useScreenTitle('invitation')
  const { inviteId = '' } = useParams()
  const path = `/invite/${inviteId}`
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { session, signOut } = useAuth()
  const profile = useProfile()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)

  useEffect(() => {
    if (readReturnTo() === path) clearReturnTo()
  }, [path])

  const invite = useQuery({
    queryKey: ['invite', inviteId],
    retry: false,
    queryFn: async () => {
      const { data, error: apiError, response } = await api.GET('/api/invites/{invite_id}', {
        params: { path: { invite_id: inviteId } },
      })
      if (apiError || !data) {
        throw new InviteLoadError(
          response.status,
          formatApiError(apiError, 'we could not load that invitation.'),
        )
      }
      return data
    },
  })

  async function respond(action: 'accept' | 'decline') {
    setBusy(action)
    setError(null)
    const route =
      action === 'accept' ? '/api/invites/{invite_id}/accept' : '/api/invites/{invite_id}/decline'
    const { data, error: apiError } = await api.POST(route, {
      params: { path: { invite_id: inviteId } },
    })
    setBusy(null)
    if (apiError || !data) {
      setError(formatApiError(apiError, 'that did not work. try again.'))
      invite.refetch()
      return
    }
    qc.setQueryData(['invite', inviteId], data)
    qc.invalidateQueries({ queryKey: ['notifications'] })
    if (action === 'accept') {
      qc.invalidateQueries({ queryKey: ['families'] })
      qc.invalidateQueries({ queryKey: ['tree'] })
      qc.invalidateQueries({ queryKey: ['invites'] })
    }
  }

  async function switchAccount() {
    rememberReturnTo(path)
    try {
      await signOut()
    } catch {
      /* still let them pick another account */
    }
    qc.clear()
    navigate('/sign-in', { replace: true })
  }

  if (invite.isLoading) {
    return (
      <ScreenBody screen="invite-loading">
        <Header title="invitation" back="/" />
        <Loading label="opening your invitation…" />
      </ScreenBody>
    )
  }

  if (invite.isError) {
    const status = invite.error instanceof InviteLoadError ? invite.error.status : 0
    return (
      <ScreenBody screen="invite-error">
        <Header title={status === 403 ? 'not for this account' : 'invitation'} back="/" />
        {status === 404 ? (
          <EmptyState title="this link doesn't work">we could not find that invitation. ask for a new link.</EmptyState>
        ) : status === 403 ? (
          <Notice tone="error">
            {invite.error.message}
            {session?.user.email && <p className="mt-1 break-all text-muted">you are signed in as {session.user.email}.</p>}
          </Notice>
        ) : (
          <ErrorState message={invite.error.message} onRetry={() => invite.refetch()} />
        )}
        <div className="mt-auto flex flex-col gap-3 pt-8">
          {status === 403 && <Button onClick={switchAccount}>sign in with that email →</Button>}
          <HandLink to="/">home</HandLink>
        </div>
      </ScreenBody>
    )
  }

  const data = invite.data as Schemas['Invite']
  const inviter = data.inviter_name || 'someone'
  const role = `${possessive(data.anchor_name)} ${kindLabel(data.kind)}`
  const myName = profile.data?.display_name || session?.user.email || 'you'
  const isRecipient = data.can_respond || session?.user.email?.toLowerCase() === data.email.toLowerCase()

  return (
    <ScreenBody screen="invite-response">
      <Header title={isRecipient ? `${inviter} invited you` : 'your invitation'} back="/" />
      <div className="mt-2 flex items-start justify-center gap-3" aria-hidden>
        <Person label={data.anchor_name} name={data.anchor_name} />
        <span className="mt-12 h-0.5 w-8 shrink-0 bg-ink" />
        <Person label={isRecipient ? 'you' : data.email} name={isRecipient ? myName : data.email} highlight={isRecipient} />
      </div>
      <p className="mt-8 text-center font-hand text-[2.1rem] leading-[1.05] break-words">join as {role}</p>
      {isRecipient && (
        <p className="mt-3 text-center font-sans text-[1.15rem] leading-snug break-words text-muted" data-testid="invite-meaning">
          accepting adds you to “{data.family_name}” as {role}. {data.anchor_name} is your {reverse(data.kind)}.
        </p>
      )}

      <div className="mt-auto flex flex-col gap-3 pt-8">
        <FormError>{error}</FormError>
        {data.status === 'pending' && data.can_respond && (
          <>
            <Button onClick={() => respond('accept')} disabled={busy !== null}>
              {busy === 'accept' ? 'joining…' : 'accept →'}
            </Button>
            <Button tone="secondary" onClick={() => respond('decline')} disabled={busy !== null}>
              {busy === 'decline' ? 'declining…' : 'decline'}
            </Button>
          </>
        )}
        {data.status === 'pending' && !data.can_respond && (
          <Notice>waiting for {data.email} to answer.</Notice>
        )}
        {data.status === 'accepted' && (
          <>
            <Notice tone="success">
              {isRecipient
                ? 'you are in the family.'
                : `${data.email} joined the family.`}
            </Notice>
            <Button to="/family">open family tree →</Button>
          </>
        )}
        {data.status === 'declined' && (
          <>
            <Notice>this invitation was declined.</Notice>
            <HandLink to="/">home</HandLink>
          </>
        )}
      </div>
    </ScreenBody>
  )
}

/** What the anchor is to the recipient, given what the recipient is to the anchor. */
function reverse(kind: Schemas['Invite']['kind']) {
  if (['parent', 'father', 'mother'].includes(kind)) return 'child'
  if (['child', 'son', 'daughter'].includes(kind)) return 'parent'
  if (['grandparent', 'grandfather', 'grandmother'].includes(kind)) return 'grandchild'
  if (['grandchild', 'grandson', 'granddaughter'].includes(kind)) return 'grandparent'
  if (['brother', 'sister'].includes(kind)) return 'sibling'
  return kindLabel(kind)
}

function Person({ label, name, highlight }: { label: string; name: string; highlight?: boolean }) {
  return (
    <div className="flex w-32 flex-col items-center gap-1.5">
      <Avatar name={name} size="lg" highlight={highlight} />
      <span className="text-center font-sans text-[1.25rem] leading-tight break-words">{label}</span>
    </div>
  )
}
