import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState, type FormEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { Copy } from 'lucide-react'
import {
  Avatar,
  Button,
  ErrorState,
  FormError,
  HandLink,
  Header,
  Loading,
  Notice,
  ScreenBody,
} from '@/components/ui/chrome'
import { TextField } from '@/components/ui/fields'
import { api, type Schemas } from '@/lib/api'
import { formatApiError } from '@/lib/apiError'
import { copyText, inviteLink } from '@/lib/clipboard'
import { useFamily, useFamilyTree } from '@/lib/family'
import { INVITE_KINDS, kindLabel, possessive, relationTo, type InviteKind } from '@/lib/relations'
import { useScreenTitle } from '@/lib/useScreenTitle'

/** Screen 22: invite someone to join as a relative of one person in the tree. */
export function InviteRelative() {
  useScreenTitle('invite a relative')
  const { personId } = useParams()
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const qc = useQueryClient()
  const family = useFamily()
  const tree = useFamilyTree(family.data?.id)
  const [draftKind, setKind] = useState<InviteKind | null>(null)
  const [method, setMethod] = useState<'connected' | 'email'>('connected')
  const [selectedUser, setSelectedUser] = useState(search.get('connection') ?? '')
  const connections = useQuery({
    queryKey: ['tree-connections', family.data?.id],
    enabled: !!family.data?.id,
    queryFn: async () => {
      const { data, error } = await api.GET('/api/families/{family_id}/tree/connections', {
        params: { path: { family_id: family.data!.id } },
      })
      if (error || !data) throw new Error(formatApiError(error, 'we could not load your connections.'))
      return data
    },
  })
  const chosen = connections.data?.find((c) => c.user_id === selectedUser)
  const existing = tree.data?.relationships.find((e) =>
    (e.a === chosen?.person_id && e.b === personId) || (e.b === chosen?.person_id && e.a === personId))
  const savedRole = existing && (chosen?.person_id === existing.a ? existing.a_role : existing.b_role)
  const aliases: Record<string, InviteKind> = { dad: 'father', mom: 'mother', grandpa: 'grandfather', grandma: 'grandmother', partner: 'spouse' }
  const savedKind = savedRole && (aliases[savedRole] ?? INVITE_KINDS.find((r) => r.id === savedRole)?.id)
  const fallback: InviteKind = existing?.kind === 'parent'
    ? chosen?.person_id === existing.a ? 'parent' : 'child'
    : existing?.kind === 'grandparent' ? chosen?.person_id === existing.a ? 'grandparent' : 'grandchild'
    : existing?.kind === 'spouse' ? 'spouse' : existing?.kind === 'sibling' ? 'sibling'
    : chosen?.kind === 'friend' ? 'friend' : 'parent'
  const kind = draftKind ?? (method === 'connected' ? savedKind || fallback : 'parent')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<Schemas['Invite'] | null>(null)
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null)

  if (family.isLoading || tree.isLoading) {
    return (
      <ScreenBody screen="invite-loading">
        <Header title="add a relative" back="/family" />
        <Loading />
      </ScreenBody>
    )
  }
  const anchor = tree.data?.people.find((p) => p.id === personId)
  if (!family.data || !tree.data || !anchor) {
    const failed = family.isError || tree.isError
    return (
      <ScreenBody screen="invite-missing">
        <Header title="add a relative" back="/family" />
        {failed ? (
          <ErrorState
            message={tree.error?.message ?? family.error?.message}
            onRetry={() => (family.isError ? family.refetch() : tree.refetch())}
          />
        ) : (
          <Notice tone="error">we could not find that person in your family.</Notice>
        )}
        <div className="mt-auto pt-8">
          <Button tone="secondary" to="/family">
            back to the tree
          </Button>
        </div>
      </ScreenBody>
    )
  }

  const familyId = family.data.id
  const anchorIsYou = anchor.id === tree.data.me
  const owner = anchorIsYou ? 'your' : possessive(anchor.display_name)
  const phrase = relationTo(kind, anchor.display_name, anchorIsYou)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (method === 'connected') {
      if (!chosen?.person_id) {
        setError('choose a connected person who has joined this family.')
        return
      }
      setBusy(true)
      try {
        const { error: apiError } = await api.POST('/api/families/{family_id}/tree/connections', {
          params: { path: { family_id: familyId } },
          body: { user_id: chosen.user_id, anchor_person_id: anchor!.id, kind },
        })
        if (apiError) throw new Error(formatApiError(apiError, 'we could not add them to the tree.'))
        await qc.invalidateQueries({ queryKey: ['tree', familyId] })
        navigate('/family')
      } catch (error) {
        setError(error instanceof Error ? error.message : 'we could not add them to the tree.')
      } finally {
        setBusy(false)
      }
      return
    }
    if (!email.includes('@')) {
      setError('add their email address.')
      return
    }
    setBusy(true)
    const { data, error: apiError } = await api.POST('/api/families/{family_id}/invites', {
      params: { path: { family_id: familyId } },
      body: { anchor_person_id: anchor!.id, kind, email: email.trim() },
    })
    setBusy(false)
    if (apiError || !data) {
      setError(formatApiError(apiError, 'we could not create that invitation. try again.'))
      return
    }
    qc.invalidateQueries({ queryKey: ['invites', familyId] })
    setSent(data)
  }

  if (sent) {
    const link = inviteLink(sent.id)
    return (
      <ScreenBody screen="invite-ready">
        <Header title="invitation ready" back="/family" />
        <Notice tone="success" title="saved">
          once {sent.email} accepts, they join the tree as {relationTo(sent.kind, sent.anchor_name, anchorIsYou)}.
        </Notice>
        <p className="mt-5 font-sans text-[1.2rem] leading-snug">
          no email is sent. copy this link and send it to them yourself. if they already have an account, it also
          shows up in their notifications.
        </p>
        <p
          className="hand-box mt-4 border-2 border-dashed border-ink/60 px-4 py-3 font-sans text-[1rem] break-all select-all"
          data-testid="invite-link"
        >
          {link}
        </p>
        <div className="mt-auto flex flex-col gap-3 pt-8">
          {copied === 'failed' && <FormError>copy did not work. select the link above instead.</FormError>}
          <Button onClick={async () => setCopied((await copyText(link)) ? 'yes' : 'failed')}>
            {copied === 'yes' ? (
              'copied ✓'
            ) : (
              <>
                <Copy className="size-6" strokeWidth={2.2} aria-hidden /> copy link
              </>
            )}
          </Button>
          <HandLink to="/family">back to the tree</HandLink>
        </div>
      </ScreenBody>
    )
  }

  return (
    <ScreenBody screen="invite-relative">
      <Header title={`add ${owner} ${kindLabel(kind)}`} back="/family" />
      <div className="flex flex-col items-center gap-2">
        <Avatar name={anchor.display_name} src={anchor.avatar_url} size="lg" highlight={anchorIsYou} />
        <p className="text-center font-sans text-[1.3rem] leading-tight break-words">
          {anchorIsYou ? `you (${anchor.display_name})` : anchor.display_name}
        </p>
      </div>
      <form onSubmit={submit} className="mt-6 flex flex-1 flex-col gap-5" noValidate>
        <div className="flex flex-wrap gap-2" aria-label="how to add someone">
          <Button tone={method === 'connected' ? 'primary' : 'secondary'} onClick={() => { setMethod('connected'); setError(null) }}>
            your connections
          </Button>
          <Button tone={method === 'email' ? 'primary' : 'secondary'} onClick={() => { setMethod('email'); setError(null) }}>
            invite by email
          </Button>
        </div>
        {method === 'connected' && <div className="flex flex-col gap-2">
          {connections.isLoading && <Loading label="loading connections…" />}
          {connections.isError && <ErrorState message={connections.error.message} onRetry={() => connections.refetch()} />}
          <label className="flex flex-col gap-1.5 font-sans text-[1.35rem]">
            connected person
            <select value={selectedUser} onChange={(e) => { setSelectedUser(e.target.value); setKind(null) }}
              className="hand-box h-14 w-full min-w-0 border-[1.5px] border-ink/40 bg-paper px-4 text-[1.2rem]">
              <option value="">choose someone</option>
              {(connections.data ?? []).map((c) => {
                const linked = tree.data!.relationships.some((e) =>
                  (e.a === c.person_id && e.b === anchor!.id) || (e.b === c.person_id && e.a === anchor!.id))
                return <option key={c.user_id} value={c.user_id} disabled={!c.person_id || c.person_id === anchor!.id}>
                  {c.display_name}{linked ? ' · already in tree' : !c.person_id ? ' · invitation needed' : ''}
                </option>
              })}
            </select>
          </label>
          {connections.data?.length === 0 && <p className="text-muted">no connections yet. connect from the family tree, or share an invitation.</p>}
        </div>}
        <RelationshipSelect value={kind} onChange={setKind} />
        <p className="font-sans text-[1.1rem] leading-snug text-muted" data-testid="invite-direction">
          {method === 'connected' ? 'they will appear as ' : 'the person you invite joins as '}
          <strong className="font-normal text-ink">{phrase}</strong>.
        </p>
        {method === 'email' && <TextField
          label="their email address"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="off"
          value={email}
          onChange={setEmail}
        />}
        <div className="mt-auto flex flex-col gap-3 pt-4">
          <FormError>{error}</FormError>
          <Button type="submit" disabled={busy}>
            {busy ? 'saving…' : method === 'connected' ? 'add to the tree →' : 'send invitation →'}
          </Button>
          <p className="text-center font-sans text-[1.05rem] leading-snug text-muted">
            {method === 'connected' ? 'uses their existing person in this family. no invitation is needed.' : 'you get a link to share. no email is sent.'}
          </p>
        </div>
      </form>
    </ScreenBody>
  )
}

function RelationshipSelect({ value, onChange }: { value: InviteKind; onChange: (kind: InviteKind) => void }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-sans text-[1.35rem] leading-none">
        relationship
      </label>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value as InviteKind)}
          className="hand-box h-14 w-full appearance-none border-[1.5px] border-ink/40 bg-paper px-4 pr-12 font-sans text-[1.3rem] text-ink outline-none focus:border-ink focus-visible:ring-2 focus-visible:ring-sun"
        >
          {INVITE_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
        <span aria-hidden className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 font-sans text-2xl">
          ▾
        </span>
      </div>
    </div>
  )
}
