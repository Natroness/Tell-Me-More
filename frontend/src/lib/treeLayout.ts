import type { Schemas } from '@/lib/api'
import { treeRelation } from '@/lib/relations'

type Tree = Schemas['FamilyTree']
type Person = Schemas['Person']

export const NODE = 64
const CELL_W = 100
const ROW_H = 180
const PAD = 28
const ROLE_H = 28
const FRIEND_GAP = 80
/** Space under each circle for a name label of up to two lines, so connectors start below it. */
export const LABEL_H = 46

export type PlacedPerson = { id: string; name: string; role: string; x: number; y: number }
export type Connector = { key: string; d: string; friend?: boolean }
export type TreeLayout = {
  nodes: PlacedPerson[]
  connectors: Connector[]
  width: number
  height: number
  /** People added by name with no relationship yet; listed beside the tree, not in it. */
  unplaced: Person[]
}

/**
 * Generations come from parent edges ("a is parent of b" puts a one row above b); spouses and
 * siblings share a row. Rows are ordered by their parents' positions and keep spouses together.
 */
export function layoutTree(tree: Tree): TreeLayout {
  const known = new Set(tree.people.map((p) => p.id))
  const allEdges = tree.relationships.filter((e) => known.has(e.a) && known.has(e.b))
  const edges = allEdges.filter((e) => e.kind !== 'friend')
  const friendEdges = allEdges.filter((e) => e.kind === 'friend')
  const linked = new Set(allEdges.flatMap((e) => [e.a, e.b]))
  function component(roots: string[]) {
    const found = new Set(roots)
    const queue = [...roots]
    for (const id of queue) {
      for (const e of edges) {
        const other = e.a === id ? e.b : e.b === id ? e.a : null
        if (other && !found.has(other)) { found.add(other); queue.push(other) }
      }
    }
    return found
  }
  const core = component(tree.me ? [tree.me] : [])
  const friends = component(friendEdges.flatMap((e) => [e.a, e.b]).filter((id) => !core.has(id)))
  const friendAnchors = new Map<string, string>()
  for (const e of friendEdges) {
    if (core.has(e.a) && friends.has(e.b)) friendAnchors.set(e.b, e.a)
    if (core.has(e.b) && friends.has(e.a)) friendAnchors.set(e.a, e.b)
  }
  const gen = new Map<string, number>()
  const seen: string[] = []

  const roots = [tree.me, ...tree.people.filter((p) => !friends.has(p.id)).map((p) => p.id),
    ...friendAnchors.keys(), ...tree.people.map((p) => p.id)].filter(
    (id): id is string => !!id && (id === tree.me || linked.has(id)),
  )
  for (const root of roots) {
    if (gen.has(root)) continue
    gen.set(root, gen.get(friendAnchors.get(root) ?? '') ?? 0)
    const queue = [root]
    while (queue.length) {
      const id = queue.shift()!
      seen.push(id)
      for (const e of edges) {
        if (e.a !== id && e.b !== id) continue
        const other = e.a === id ? e.b : e.a
        if (gen.has(other)) continue
        const g = gen.get(id)!
        const span = e.kind === 'parent' ? 1 : e.kind === 'grandparent' ? 2 : 0
        gen.set(other, g + (e.a === id ? span : -span))
        queue.push(other)
      }
    }
  }

  const spousesOf = (id: string) =>
    edges.filter((e) => e.kind === 'spouse' && (e.a === id || e.b === id)).map((e) => (e.a === id ? e.b : e.a))
  const parentsOf = (id: string) => edges.filter((e) => (e.kind === 'parent' || e.kind === 'grandparent') && e.b === id).map((e) => e.a)

  const withSpouses = (ids: string[]) => {
    const out: string[] = []
    for (const id of ids) {
      if (out.includes(id)) continue
      out.push(id)
      for (const s of spousesOf(id)) if (ids.includes(s) && !out.includes(s)) out.push(s)
    }
    return out
  }

  const gens = [...new Set(gen.values())].sort((a, b) => a - b)
  const rows = new Map<number, string[]>()
  const col = new Map<string, number>()
  for (const g of gens) {
    let row = withSpouses(seen.filter((id) => gen.get(id) === g))
    const key = (id: string, i: number) => {
      const ps = parentsOf(id).filter((p) => col.has(p))
      if (ps.length) return ps.reduce((sum, p) => sum + col.get(p)!, 0) / ps.length
      const partner = spousesOf(id).find((s) => parentsOf(s).some((p) => col.has(p)))
      if (partner) return key(partner, i)
      return i - row.length / 2
    }
    row = withSpouses(
      row
        .map((id, i) => ({ id, k: key(id, i) }))
        .sort((a, b) => a.k - b.k)
        .map((r) => r.id),
    )
    for (const side of [false, true]) {
      const group = row.filter((id) => friends.has(id) === side)
      group.forEach((id, i) => col.set(id, i - (group.length - 1) / 2))
    }
    rows.set(g, row)
  }

  const familyWidth = Math.max(1, ...[...rows.values()].map((r) => r.filter((id) => !friends.has(id)).length)) * CELL_W
  const friendWidth = Math.max(0, ...[...rows.values()].map((r) => r.filter((id) => friends.has(id)).length)) * CELL_W
  const width = PAD * 2 + familyWidth + (friendWidth ? FRIEND_GAP + friendWidth : 0)
  const minGeneration = Math.min(0, ...gens)
  const span = Math.max(0, ...gens) - minGeneration + 1
  const height = PAD * 2 + ROLE_H + span * ROW_H - (ROW_H - NODE - LABEL_H)
  const names = new Map(tree.people.map((p) => [p.id, p.display_name]))
  const pos = new Map<string, { x: number; y: number }>()
  const nodes: PlacedPerson[] = []
  gens.forEach((g) => {
    for (const id of rows.get(g)!) {
      const center = friends.has(id)
        ? PAD + familyWidth + FRIEND_GAP + friendWidth / 2 : PAD + familyWidth / 2
      const x = center + col.get(id)! * CELL_W
      const y = PAD + ROLE_H + (g - minGeneration) * ROW_H + NODE / 2
      pos.set(id, { x, y })
      nodes.push({ id, name: names.get(id) ?? '', role: treeRelation(tree, id), x, y })
    }
  })

  const r = NODE / 2
  const connectors: Connector[] = []
  for (const e of allEdges) {
    const a = pos.get(e.a)
    const b = pos.get(e.b)
    if (!a || !b || e.kind === 'parent' || e.kind === 'grandparent') continue
    const [left, right] = a.x <= b.x ? [a, b] : [b, a]
    if (e.kind === 'friend') {
      const mid = (left.x + right.x) / 2
      connectors.push({ key: `f-${e.a}-${e.b}`, friend: true,
        d: `M${left.x + r} ${left.y}C${mid} ${left.y},${mid} ${right.y},${right.x - r} ${right.y}` })
    } else if (e.kind === 'spouse') {
      connectors.push({ key: `s-${e.a}-${e.b}`, d: `M${left.x + r} ${left.y}H${right.x - r}` })
    } else {
      const shared = parentsOf(e.a).some((p) => parentsOf(e.b).includes(p))
      if (shared) continue
      const top = left.y - r - 14
      connectors.push({
        key: `b-${e.a}-${e.b}`,
        d: `M${left.x} ${left.y - r}V${top}H${right.x}V${right.y - r}`,
      })
    }
  }
  for (const child of nodes) {
    const ids = parentsOf(child.id).filter((p) => pos.has(p))
    if (!ids.length) continue
    const parents = ids.map((p) => pos.get(p)!)
    const c = pos.get(child.id)!
    const midY = c.y - r - 26
    const couple =
      ids.length === 2 &&
      spousesOf(ids[0]).includes(ids[1]) &&
      Math.abs(parents[0].y - parents[1].y) < 1
    const starts = couple
      ? [{ x: (parents[0].x + parents[1].x) / 2, y: parents[0].y }]
      : parents.map((p) => ({ x: p.x, y: p.y + r + LABEL_H }))
    starts.forEach((s, i) =>
      connectors.push({ key: `p-${child.id}-${i}`, d: `M${s.x} ${s.y}V${midY}H${c.x}V${c.y - r}` }),
    )
  }

  return {
    nodes,
    connectors,
    width,
    height,
    unplaced: tree.people.filter((p) => !gen.has(p.id)),
  }
}
