import type { Schemas } from '@/lib/api'

export type InviteKind = Schemas['CreateInvite']['kind']

/** `kind` is always the invited person relative to the anchor: parent = the anchor's parent. */
export const INVITE_KINDS: { id: InviteKind; label: string }[] = [
  { id: 'parent', label: 'parent' },
  { id: 'child', label: 'child' },
  { id: 'spouse', label: 'spouse or partner' },
  { id: 'sibling', label: 'sibling' },
]

export function kindLabel(kind: InviteKind) {
  return INVITE_KINDS.find((k) => k.id === kind)?.label ?? kind
}

export function possessive(name: string) {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`
}

/** "your parent" when the anchor is you, otherwise "grandpa's parent". */
export function relationTo(kind: InviteKind, anchorName: string, anchorIsYou: boolean) {
  return `${anchorIsYou ? 'your' : possessive(anchorName)} ${kindLabel(kind)}`
}

function names(list: string[]) {
  return list.length <= 2 ? list.join(' & ') : `${list.slice(0, -1).join(', ')} & ${list[list.length - 1]}`
}

/** "child of ram & sita" for the profile screen; null when the tree has no close edge for you. */
export function describeMe(tree: Schemas['FamilyTree']): string | null {
  const me = tree.me
  if (!me) return null
  const name = (id: string) => tree.people.find((p) => p.id === id)?.display_name
  const linked = (pick: (e: Schemas['Relationship']) => string | null) =>
    tree.relationships.map(pick).filter((id): id is string => !!id).map(name).filter((n): n is string => !!n)
  const parents = linked((e) => (e.kind === 'parent' && e.b === me ? e.a : null))
  if (parents.length) return `child of ${names(parents)}`
  const partners = linked((e) => (e.kind === 'spouse' && (e.a === me || e.b === me) ? (e.a === me ? e.b : e.a) : null))
  if (partners.length) return `partner of ${names(partners)}`
  const children = linked((e) => (e.kind === 'parent' && e.a === me ? e.b : null))
  if (children.length) return `parent of ${names(children)}`
  return null
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}
