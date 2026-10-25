import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState, type FormEvent } from 'react'
import { Copy } from 'lucide-react'
import { FamilyTreeView } from '@/components/family/FamilyTreeView'
import {
  Avatar,
  Button,
  Card,
  Chip,
  Disclosure,
  ErrorState,
  FormError,
  Header,
  Loading,
  ScreenBody,
} from '@/components/ui/chrome'
import { TextField } from '@/components/ui/fields'
import { TreeIcon } from '@/components/ui/sketchIcons'
import { api, type Schemas } from '@/lib/api'
import { formatApiError } from '@/lib/apiError'
import { useAuth } from '@/lib/auth'
import { copyText, inviteLink } from '@/lib/clipboard'
import { useChooseFamily, useFamilies, useFamily, useFamilyInvites, useFamilyTree } from '@/lib/family'
import { useProfile } from '@/lib/profile'
import { useLiveQuery } from '@/lib/realtime'
import { possessive, relationTo, treeRelation } from '@/lib/relations'
import { layoutTree } from '@/lib/treeLayout'
import { useScreenTitle } from '@/lib/useScreenTitle'
import { cn } from '@/lib/utils'
import { Connections } from '@/routes/family/Connections'

type Family = Schemas['Family']
type Tree = Schemas['FamilyTree']
type Invite = Schemas['Invite']

export function Family() {
  useScreenTitle('family tree')
  const family = useFamily()
  if (family.isLoading) {
    return (
      <ScreenBody screen="family-loading">
        <Header title="family tree" back="/" />
        <Loading label="opening your family…" />
      </ScreenBody>
    )
  }
  if (family.isError) {
    return (
      <ScreenBody screen="family-error">
        <Header title="family tree" back="/" />
        <ErrorState message={family.error.message} onRetry={() => family.refetch()} />
      </ScreenBody>
    )
  }
  if (!family.data) return <CreateFamily />
  return <FamilyTreeScreen family={family.data} />
}

function CreateFamily() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const profile = useProfile()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim()) {
      setError('add a family name.')
      return
    }
    const yourName =
      profile.data?.display_name?.trim() || session?.user.email?.split('@')[0] || 'me'
    setBusy(true)
    const { data, error: apiError } = await api.POST('/api/families', {
      body: { name: name.trim(), your_name: yourName },
    })
    setBusy(false)
    if (apiError || !data) {
      setError(formatApiError(apiError, 'we could not create your family. try again.'))
      return
    }
    qc.setQueryData(['families'], [data])
    qc.invalidateQueries({ queryKey: ['families'] })
  }

  return (
    <ScreenBody screen="family-setup">
      <Header title="family tree" back="/" />
      <div className="flex justify-center">
        <TreeIcon />
      </div>
      <p className="mt-4 text-center font-sans text-[1.25rem] leading-snug">
        start your family so you can share stories, memories, and availability together.
      </p>
      <form onSubmit={submit} className="mt-6 flex flex-1 flex-col gap-4" noValidate>
        <TextField label="family name" name="family-name" value={name} onChange={setName} />
        <div className="mt-auto flex flex-col gap-3 pt-5">
          <FormError>{error}</FormError>
          <Button type="submit" disabled={busy}>
            {busy ? 'creating…' : 'create a family →'}
          </Button>
        </div>
      </form>
    </ScreenBody>
  )
}

function relationToMe(tree: Tree, id: string): string | null {
  return !tree.me || id === tree.me ? null : `your ${treeRelation(tree, id)}`
}

function FamilyTreeScreen({ family }: { family: Family }) {
  const tree = useFamilyTree(family.id)
  const invites = useFamilyInvites(family.id)
  const [picked, setPicked] = useState<string | null>(null)
  const layout = useMemo(() => (tree.data ? layoutTree(tree.data) : null), [tree.data])
  const selectedId = picked ?? tree.data?.me ?? null
  const selected = tree.data?.people.find((p) => p.id === selectedId) ?? null
  const pending = invites.data?.filter((i) => i.status === 'pending') ?? []
  const declined = invites.data?.filter((i) => i.status === 'declined') ?? []
  const me = tree.data?.me ?? null
  const avatars = useMemo(() => new Map(tree.data?.people.map((p) => [p.id, p.avatar_url ?? null])), [tree.data])
  // Anyone in the family adding a relative shows up here without a reload.
  const treeKey = ['tree', family.id]
  useLiveQuery('person', `family_id=eq.${family.id}`, treeKey)
  useLiveQuery('relationship', `family_id=eq.${family.id}`, treeKey)
  useLiveQuery('member', `family_id=eq.${family.id}`, treeKey)

  return (
    <ScreenBody screen="family-tree">
      <Header title="family tree" back="/" />
      <p className="-mt-3 mb-4 text-center font-sans text-[1.15rem] leading-snug break-words text-muted">{family.name}</p>
      <FamilySwitcher current={family} />

      {tree.isLoading && <Loading label="loading your tree…" />}
      {tree.isError && <ErrorState message={tree.error.message} onRetry={() => tree.refetch()} />}
      {tree.data && layout && (
        <FamilyTreeView layout={layout} meId={me} selectedId={selectedId} onSelect={setPicked} avatars={avatars} />
      )}
      {me && <Button className="mt-4" tone="secondary" to={`/family/invite/${me}`}>add someone to the tree →</Button>}
      {layout?.connectors.some((c) => c.friend) &&
        <p className="mt-3 text-center font-sans text-[1rem] text-muted">solid links are family · dotted links are friends</p>}

      {layout && layout.unplaced.length > 0 && (
        <section className="mt-6">
          <h2 className="font-sans text-[1.3rem] leading-none">not in the tree yet</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {layout.unplaced.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPicked(p.id)}
                aria-pressed={p.id === selectedId}
                className={cn(
                  'hand-pill min-h-12 border-2 border-ink px-4 py-1.5 font-sans text-[1.2rem] leading-tight break-words',
                  p.id === selectedId && 'bg-sun text-black',
                )}
              >
                {p.display_name}
              </button>
            ))}
          </div>
        </section>
      )}

      {tree.data && selected && <PersonDetails tree={tree.data} person={selected} pending={pending} />}

      <section className="mt-10 flex flex-col gap-3" aria-labelledby="pending-heading">
        <h2 id="pending-heading" className="font-hand text-[1.9rem] leading-none">
          waiting to join
        </h2>
        {invites.isLoading && <Loading label="checking invitations…" />}
        {invites.isError && <ErrorState message={invites.error.message} onRetry={() => invites.refetch()} />}
        {invites.data && pending.length === 0 && (
          <p className="font-sans text-[1.15rem] leading-snug text-muted">no one is waiting to answer.</p>
        )}
        {pending.length > 0 && (
          <>
            <p className="font-sans text-[1.05rem] leading-snug text-muted">no email is sent. share each link yourself.</p>
            <ul className="flex flex-col gap-3">
              {pending.map((invite) => (
                <InviteRow key={invite.id} invite={invite} me={me} />
              ))}
            </ul>
          </>
        )}
        {declined.length > 0 && (
          <Disclosure summary={`declined (${declined.length})`}>
            <ul className="flex flex-col gap-2">
              {declined.map((invite) => (
                <li key={invite.id} className="break-words">
                  {invite.email} · as {relationTo(invite.kind, invite.anchor_name, invite.anchor_person_id === me)}
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
      </section>

      <Connections anchorPersonId={me} />
    </ScreenBody>
  )
}

/** Families you belong to besides this one. Choosing one changes what every screen shows. */
function FamilySwitcher({ current }: { current: Family }) {
  const families = useFamilies()
  const choose = useChooseFamily()
  const others = families.data?.filter((f) => f.id !== current.id) ?? []
  if (others.length === 0) return null
  return (
    <Disclosure summary={`switch family (${others.length + 1} families)`} className="mb-4">
      <ul className="flex flex-col gap-2">
        {others.map((f) => (
          <li key={f.id}>
            <Button tone="secondary" disabled={choose.isPending} onClick={() => choose.mutate(f.id)}>
              {f.name}
            </Button>
          </li>
        ))}
      </ul>
      <FormError>{choose.error?.message}</FormError>
    </Disclosure>
  )
}

function PersonDetails({
  tree,
  person,
  pending,
}: {
  tree: Tree
  person: Schemas['Person']
  pending: Invite[]
}) {
  const isMe = person.id === tree.me
  const hasAccount = tree.member_person_ids.includes(person.id)
  const waiting = pending.filter((i) => i.anchor_person_id === person.id).length
  const relation = relationToMe(tree, person.id)
  return (
    <Card className="mt-6">
      <section className="flex flex-col gap-3" aria-label={`${person.display_name} details`}>
        <div className="flex items-center gap-3">
          <Avatar name={person.display_name} src={person.avatar_url} highlight={isMe} />
          <div className="min-w-0">
            <p className="font-hand text-[1.9rem] leading-tight break-words">{isMe ? 'you' : person.display_name}</p>
            <p className="font-sans text-[1.15rem] leading-snug break-words">
              {isMe ? person.display_name : (relation ?? 'in this family')}
              {person.birth_year ? ` · born ${person.birth_year}` : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip tone={hasAccount ? 'sun' : 'plain'}>{hasAccount ? 'on tell me more' : 'no account yet'}</Chip>
          {waiting > 0 && <Chip>{waiting} pending invitation{waiting === 1 ? '' : 's'}</Chip>}
        </div>
        <Button to={`/family/invite/${person.id}`}>
          {isMe ? 'add your relative →' : `add ${possessive(person.display_name)} relative →`}
        </Button>
      </section>
    </Card>
  )
}

function InviteRow({ invite, me }: { invite: Invite; me: string | null }) {
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null)
  const link = inviteLink(invite.id)
  return (
    <li>
      <Card tone="dashed">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-sans text-[1.2rem] leading-snug break-all">{invite.email}</p>
            <p className="font-sans text-[1.05rem] leading-snug text-muted">
              as {relationTo(invite.kind, invite.anchor_name, invite.anchor_person_id === me)}
            </p>
          </div>
          <button
            type="button"
            onClick={async () => setCopied((await copyText(link)) ? 'yes' : 'failed')}
            className="hand-pill inline-flex min-h-12 shrink-0 items-center gap-1.5 border-2 border-ink px-3 font-sans text-[1.15rem] leading-none"
          >
            {copied === 'yes' ? (
              'copied ✓'
            ) : (
              <>
                <Copy className="size-4" strokeWidth={2.2} aria-hidden /> copy link
              </>
            )}
          </button>
        </div>
        {copied === 'failed' && (
          <p className="mt-2 font-sans text-[0.95rem] break-all select-all">copy did not work. select this link: {link}</p>
        )}
      </Card>
    </li>
  )
}
