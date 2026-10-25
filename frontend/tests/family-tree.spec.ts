import { test, expect, mockApp, FAMILY, PERSON } from './fixtures'

const CHILD = '30000000-0000-4000-8000-000000000001'
const DAD = '30000000-0000-4000-8000-000000000002'
const GRANDPA = '30000000-0000-4000-8000-000000000003'
const FRIEND = '30000000-0000-4000-8000-000000000004'
const CHILD_USER = '40000000-0000-4000-8000-000000000001'

function person(id: string, display_name: string) {
  return { id, family_id: FAMILY, display_name, full_name: null, relation_label: null,
    birth_year: null, is_living: true, degree: 0, relation: null }
}

function graph() {
  return {
    me: PERSON, people: [person(PERSON, 'Morgan'), person(CHILD, 'Jimmy'), person(DAD, 'Big Guy'),
      person(GRANDPA, 'Grandpa'), person(FRIEND, 'Asher')],
    member_person_ids: [PERSON, CHILD, DAD, GRANDPA, FRIEND],
    relationships: [
      { a: PERSON, b: CHILD, kind: 'parent', a_role: 'parent', b_role: 'son' },
      { a: DAD, b: PERSON, kind: 'parent', a_role: 'dad', b_role: 'child' },
      { a: GRANDPA, b: PERSON, kind: 'grandparent', a_role: 'grandpa', b_role: 'grandchild' },
      { a: FRIEND, b: PERSON, kind: 'friend', a_role: 'friend', b_role: 'friend' },
    ],
  }
}

test('generations, node roles and dotted friend links match the family graph', async ({ page }) => {
  const state = await mockApp(page)
  const tree = graph()
  await page.route(`**/api/families/${FAMILY}/tree`, (route) => route.fulfill({ json: tree }))
  await page.goto('/family')
  await expect(page.getByRole('button', { name: 'Jimmy (son)', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Big Guy (dad)', exact: true })).toHaveCount(1)
  await expect(page.locator('path[data-kind="friend"]')).toHaveAttribute('stroke-dasharray', '1 7')
  const nodes = await page.evaluate(async (tree) => {
    const { layoutTree } = await import('/src/lib/treeLayout.ts')
    return layoutTree(tree).nodes
  }, tree)
  const at = (id: string) => nodes.find((n: any) => n.id === id)!
  expect(at(GRANDPA).y).toBeLessThan(at(DAD).y)
  expect(at(DAD).y).toBeLessThan(at(PERSON).y)
  expect(at(PERSON).y).toBeLessThan(at(CHILD).y)
  expect(at(FRIEND).x - Math.max(...nodes.filter((n: any) => n.id !== FRIEND).map((n: any) => n.x))).toBeGreaterThan(100)
  expect(state.errors).toEqual([])
  expect(state.unexpected).toEqual([])
})

test('a connected person can be added as a son without an email invitation', async ({ page }) => {
  const state = await mockApp(page)
  const tree = { ...graph(), people: [person(PERSON, 'Morgan'), person(CHILD, 'Jimmy')], relationships: [] as any[] }
  await page.route(`**/api/families/${FAMILY}/tree`, (route) => route.fulfill({ json: tree }))
  await page.route('**/api/connections', (route) => route.fulfill({ json: [
    { user_id: CHILD_USER, display_name: 'Jimmy', kind: 'family', story_count: 0 },
  ] }))
  await page.route(`**/api/families/${FAMILY}/tree/connections`, async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [
      { user_id: CHILD_USER, display_name: 'Jimmy', kind: 'family', person_id: CHILD },
    ] })
    expect(route.request().postDataJSON()).toEqual({ user_id: CHILD_USER, anchor_person_id: PERSON, kind: 'son' })
    const edge = { a: PERSON, b: CHILD, kind: 'parent', a_role: 'parent', b_role: 'son' }
    tree.relationships.push(edge)
    await route.fulfill({ json: edge })
  })
  await page.goto('/family')
  await page.getByRole('link', { name: 'add Jimmy to the tree' }).click()
  await expect(page.getByLabel('connected person')).toHaveValue(CHILD_USER)
  await page.getByLabel('relationship', { exact: true }).selectOption('son')
  await expect(page.getByLabel('relationship', { exact: true }).locator('option[value="grandparent"]')).toHaveCount(1)
  await page.getByRole('button', { name: 'add to the tree →', exact: true }).click()
  await expect(page).toHaveURL('/family')
  await expect(page.getByRole('button', { name: 'Jimmy (son)', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'add Jimmy to the tree' }).click()
  await expect(page.getByLabel('relationship', { exact: true })).toHaveValue('son')
  expect(state.calls.some((c) => c.startsWith('post ') && c.includes('/invites'))).toBe(false)
  expect(state.errors).toEqual([])
  expect(state.unexpected).toEqual([])
})

test('missing generations remain spaced and ancestry is inferred without invented people', async ({ page }) => {
  await mockApp(page)
  await page.goto('/family')
  const result = await page.evaluate(async ({ tree, root, dad, grandpa }) => {
    const { layoutTree } = await import('/src/lib/treeLayout.ts')
    const { treeRelation } = await import('/src/lib/relations.ts')
    const direct = { ...tree, people: tree.people.filter((p: any) => p.id === root || p.id === grandpa),
      relationships: tree.relationships.filter((e: any) => e.kind === 'grandparent') }
    const layout = layoutTree(direct)
    const chain = { ...tree, relationships: [
      { a: dad, b: root, kind: 'parent' }, { a: grandpa, b: dad, kind: 'parent' },
    ] }
    return { nodes: layout.nodes, relation: treeRelation(chain, grandpa) }
  }, { tree: graph(), root: PERSON, dad: DAD, grandpa: GRANDPA })
  expect(result.nodes).toHaveLength(2)
  expect(result.nodes.find((n: any) => n.id === PERSON)!.y - result.nodes.find((n: any) => n.id === GRANDPA)!.y).toBe(360)
  expect(result.relation).toBe('grandparent')
})
