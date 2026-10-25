import type { Schemas } from '@/lib/api'

export type InviteKind = Schemas['CreateInvite']['kind']

/** `kind` is always the invited person relative to the anchor: parent = the anchor's parent. */
export const INVITE_KINDS: { id: InviteKind; label: string }[] = [
  { id: 'parent', label: 'parent' },
  { id: 'father', label: 'dad / father' },
  { id: 'mother', label: 'mom / mother' },
  { id: 'child', label: 'child' },
  { id: 'son', label: 'son' },
  { id: 'daughter', label: 'daughter' },
  { id: 'grandparent', label: 'grandparent' },
  { id: 'grandfather', label: 'grandpa / grandfather' },
  { id: 'grandmother', label: 'grandma / grandmother' },
  { id: 'grandchild', label: 'grandchild' },
  { id: 'grandson', label: 'grandson' },
  { id: 'granddaughter', label: 'granddaughter' },
  { id: 'spouse', label: 'spouse or partner' },
  { id: 'sibling', label: 'sibling' },
  { id: 'brother', label: 'brother' },
  { id: 'sister', label: 'sister' },
  { id: 'friend', label: 'friend' },
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

/** Roles are relative to this viewer, never guessed from a person's name or age. */
export function treeRelation(tree: Schemas['FamilyTree'], id: string): string {
  const me = tree.me
  if (id === me) return 'you'
  const direct = tree.relationships.find((e) => (e.a === me && e.b === id) || (e.b === me && e.a === id))
  if (direct) {
    const role = id === direct.a ? direct.a_role : direct.b_role
    if (role) return role
    if (direct.kind === 'parent') return id === direct.a ? 'parent' : 'child'
    if (direct.kind === 'grandparent') return id === direct.a ? 'grandparent' : 'grandchild'
    return direct.kind === 'spouse' ? 'partner' : direct.kind
  }
  for (const direction of ['up', 'down'] as const) {
    const queue: { id: string; depth: number }[] = me ? [{ id: me, depth: 0 }] : []
    const seen = new Set<string>()
    for (const current of queue) {
      if (seen.has(current.id)) continue
      seen.add(current.id)
      if (current.id === id) {
        const noun = direction === 'up' ? 'parent' : 'child'
        return current.depth === 1 ? noun : `${'great-'.repeat(Math.max(0, current.depth - 2))}grand${noun}`
      }
      for (const e of tree.relationships) {
        if (e.kind !== 'parent' && e.kind !== 'grandparent') continue
        const from = direction === 'up' ? e.b : e.a
        const to = direction === 'up' ? e.a : e.b
        if (from === current.id) queue.push({ id: to, depth: current.depth + (e.kind === 'grandparent' ? 2 : 1) })
      }
    }
  }
  const adjacent = tree.relationships.find((e) => e.a === id || e.b === id)
  if (adjacent) {
    if (adjacent.kind === 'friend') return 'friend'
    const other = tree.people.find((p) => p.id === (adjacent.a === id ? adjacent.b : adjacent.a))
    const role = id === adjacent.a ? adjacent.a_role : adjacent.b_role
    if (role && other) return `${possessive(other.display_name)} ${role}`
  }
  return tree.people.find((p) => p.id === id)?.relation_label ?? 'relative'
}
