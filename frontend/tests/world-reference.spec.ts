import { test, expect, mockApp, OBJECT } from './fixtures'

test('worlds label generated references and let visitors change detail after a load failure', async ({ page }, testInfo) => {
  const state = await mockApp(page)
  const world = {
    id: OBJECT, heirloom_id: OBJECT, story_id: null, status: 'ready', error: null,
    narrator: 'Jimmy', label: 'Imagined from Jimmy’s words', spots: [],
    reference: { title: 'AI-generated scene reference', page_url: null, kind: 'generated' },
    assets: { spz_100k: '/preview.spz', spz_500k: '/detail.spz' },
    semantics: { metric_scale_factor: 1, ground_plane_offset: 0 },
  }
  const requested: string[] = []
  await page.route(`**/api/immersive/${OBJECT}`, (route) => route.fulfill({ json: world }))
  await page.route('**/*.spz', (route) => {
    requested.push(new URL(route.request().url()).pathname)
    return route.fulfill({ status: 404, body: 'Unavailable' })
  })
  await page.goto(`/s/${OBJECT}/w/${OBJECT}`)
  await expect(page.getByText('an AI-generated image of a similar setting', { exact: false })).toBeVisible()
  await expect(page.getByRole('link', { name: 'a public photo of a similar place' })).toHaveCount(0)
  await expect(page.getByRole('alert')).toContainText('This detail level could not load')
  await expect(page.getByRole('status')).toHaveCount(0)
  const mobile = testInfo.project.name === 'mobile'
  expect(requested).toContain(mobile ? '/preview.spz' : '/detail.spz')
  await page.getByRole('button', { name: mobile ? 'Higher detail' : 'Fast preview', exact: true }).click()
  await expect.poll(() => requested).toContain(mobile ? '/detail.spz' : '/preview.spz')
  expect(state.errors).toEqual([])
  expect(state.unexpected).toEqual([])
})
