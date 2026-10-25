import { test, expect, mockApp, session, OBJECT, INTERVIEW, ANSWER, NEXT } from './fixtures'

test('welcome and sign-in validation work without a session', async ({ page }) => {
  const state = await mockApp(page, { signedIn: false })
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'get started →' })).toBeVisible()
  await page.getByRole('link', { name: 'sign in', exact: true }).click()
  await page.getByRole('button', { name: 'continue →' }).click()
  await expect(page.getByRole('alert')).toContainText('valid email')
  expect(state.errors).toEqual([])
  expect(state.unexpected).toEqual([])
})

test('private routes redirect to welcome', async ({ page }) => {
  await mockApp(page, { signedIn: false })
  await page.goto('/stories')
  await expect(page).toHaveURL(/\/welcome$/)
})

for (const path of ['/', '/stories', '/family', '/dates', '/dates/year', '/dates/new', '/memories',
  '/availability', '/availability/me', '/availability/busy/new', '/timeline', '/account', '/notifications', '/tell', '/archive', '/capture']) {
  test(`signed-in screen ${path} renders without errors or overflow`, async ({ page }) => {
    const state = await mockApp(page)
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('[data-screen]').first()).toBeVisible()
    await expect(page.getByText('we couldn\'t open your account')).toHaveCount(0)
    await expect(page.getByRole('heading').first()).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true)
    expect(state.errors).toEqual([])
    expect(state.unexpected).toEqual([])
  })
}

test('language controls remain English only', async ({ page }) => {
  await mockApp(page)
  await page.goto('/account')
  await expect(page.getByLabel('language', { exact: true }).locator('option')).toHaveCount(1)
  await expect(page.getByLabel('language', { exact: true })).toHaveValue('en')
})

test('schedule time zones are unique even when saved and device zones match', async ({ page }) => {
  const state = await mockApp(page)
  await page.goto('/availability/me')
  await page.waitForLoadState('networkidle')
  const unique = await page.evaluate(async () => {
    const { timeZones } = await import('/src/routes/availability/data.ts')
    const values = timeZones('UTC', 'UTC', 'America/Chicago', 'America/Chicago')
    return values.length === new Set(values).size
  })
  expect(unique).toBe(true)
  expect(state.errors).toEqual([])
})

for (const publicLink of [false, true]) {
  test(`${publicLink ? 'public' : 'non-owner'} story cannot remove a video`, async ({ page }) => {
    const state = await mockApp(page, { signedIn: !publicLink, owner: false })
    await page.goto(publicLink ? `/s/${OBJECT}?k=test-code` : `/h/${OBJECT}`)
    await expect(page.getByRole('heading', { name: 'storytime video' })).toBeVisible()
    await expect(page.locator('video')).toHaveCount(1)
    await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0)
    await page.locator('video').evaluate(async (v: HTMLVideoElement) => { v.muted = true; await v.play() })
    await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0)
    await expect(page.getByRole('button', { name: 'remove video' })).toHaveCount(0)
    expect(state.errors).toEqual([])
    expect(state.unexpected).toEqual([])
  })
}

test('owner can cancel a working video and sees the shorter duration', async ({ page }) => {
  await mockApp(page, { status: 'gathering' })
  await page.goto(`/h/${OBJECT}`)
  await expect(page.getByText(/usually 30–75 seconds/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'remove video' })).toBeVisible()
})

test('switching accounts clears the previous family cache', async ({ page }) => {
  const state = await mockApp(page)
  await page.goto('/family')
  await expect(page.getByText('Test family', { exact: true })).toBeVisible()
  const before = state.calls.filter((c) => c === 'get /api/families').length
  const nextSession = session('20000000-0000-4000-8000-000000000001')
  state.family.name = 'Another family'
  await page.route('https://*.supabase.co/auth/v1/user', (route) => route.fulfill({ json: nextSession.user }))
  await page.evaluate(async (next) => {
    const { supabase } = await import('/src/lib/supabase.ts')
    const { error } = await supabase.auth.setSession(next)
    if (error) throw error
  }, { access_token: nextSession.access_token, refresh_token: nextSession.refresh_token })
  await expect(page.getByText('Another family', { exact: true })).toBeVisible()
  await expect(page.getByText('Test family', { exact: true })).toHaveCount(0)
  expect(state.calls.filter((c) => c === 'get /api/families').length).toBeGreaterThan(before)
  expect(state.errors).toEqual([])
})

test('interview advances from the streamed reply without Realtime', async ({ page }) => {
  const state = await mockApp(page)
  await page.route(`**/api/interviews/${INTERVIEW}/answers`, (route) => route.fulfill({ json: {
    turn_id: ANSWER, media_id: ANSWER, upload_url: '/fake-upload',
  } }))
  await page.routeWebSocket(/\/api\/interviews\/.*\/stream/, (ws) => {
    ws.onMessage((message) => {
      if (typeof message !== 'string' || JSON.parse(message).type !== 'end') return
      state.iv.state = 'asking'
      state.turns.push({ id: ANSWER, idx: 1, role: 'answer', text: 'She kept the watch.', target_slot: null })
      state.turns.push({ id: NEXT, idx: 2, role: 'question', text: 'Who gave her the watch?', target_slot: null })
      ws.send(JSON.stringify({ type: 'done', text: 'She kept the watch.', question: { id: NEXT, text: 'Who gave her the watch?', number: 2 }, ended: false }))
      ws.close()
    })
  })
  await page.goto(`/interview/${INTERVIEW}`)
  await expect(page.getByText('Where did the watch come from?', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'start recording', exact: true }).click()
  await expect(page.getByText('recording…', { exact: true })).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: 'pause recording', exact: true }).click()
  await expect(page.getByText('paused', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'resume recording', exact: true }).click()
  await page.getByRole('button', { name: 'finish', exact: true }).click()
  await expect(page.getByText('Who gave her the watch?', { exact: true })).toBeVisible()
  expect(state.errors).toEqual([])
  expect(state.unexpected).toEqual([])
})

test('leaving an interview stops the microphone', async ({ page }) => {
  const state = await mockApp(page)
  await page.route(`**/api/interviews/${INTERVIEW}/answers`, (route) => route.fulfill({ json: {
    turn_id: ANSWER, media_id: ANSWER, upload_url: '/fake-upload',
  } }))
  await page.routeWebSocket(/\/api\/interviews\/.*\/stream/, () => {})
  await page.goto(`/interview/${INTERVIEW}`)
  await page.getByRole('button', { name: 'start recording', exact: true }).click()
  await expect(page.getByText('recording…', { exact: true })).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: 'continue later' }).click()
  await expect(page).toHaveURL(`/h/${OBJECT}`)
  await expect.poll(() => page.evaluate(() => (window as any).__contexts.every((c: AudioContext) => c.state === 'closed'))).toBe(true)
  expect(await page.evaluate(() => (window as any).__tracks.every((t: MediaStreamTrack) => t.readyState === 'ended'))).toBe(true)
  expect(state.errors).toEqual([])
})

test('failed answer creation releases the microphone', async ({ page }) => {
  const state = await mockApp(page)
  await page.route(`**/api/interviews/${INTERVIEW}/answers`, (route) => route.fulfill({ status: 500, json: { detail: 'Try recording again.' } }))
  await page.goto(`/interview/${INTERVIEW}`)
  await page.getByRole('button', { name: 'start recording', exact: true }).click()
  await expect(page.getByText('Try recording again.')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).__tracks.length), { timeout: 10_000 }).toBeGreaterThan(0)
  await expect.poll(() => page.evaluate(() => (window as any).__tracks.every((t: MediaStreamTrack) => t.readyState === 'ended'))).toBe(true)
  expect(state.errors).toEqual([])
})

test('camera capture reaches review and releases the camera', async ({ page }) => {
  const state = await mockApp(page)
  await page.goto('/capture')
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 10_000 }).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'take photo', exact: true }).click()
  await expect(page).toHaveURL('/review')
  await expect(page.getByRole('img', { name: 'your photo of the object' })).toBeVisible()
  expect(await page.evaluate(() => (window as any).__tracks.every((t: MediaStreamTrack) => t.readyState === 'ended'))).toBe(true)
  expect(state.errors).toEqual([])
  expect(state.unexpected).toEqual([])
})

test('failed streaming uploads the WAV and polls for the queued question', async ({ page }) => {
  const state = await mockApp(page)
  let uploaded = false
  await page.route(`**/api/interviews/${INTERVIEW}/answers`, (route) => route.fulfill({ json: {
    turn_id: ANSWER, media_id: ANSWER, upload_url: '/fake-upload',
  } }))
  await page.route('**/fake-upload', async (route) => {
    expect(route.request().method()).toBe('PUT')
    expect(route.request().postDataBuffer()?.subarray(0, 4).toString()).toBe('RIFF')
    uploaded = true
    await route.fulfill({ status: 200 })
  })
  await page.route(`**/api/interviews/${INTERVIEW}/answers/${ANSWER}/complete`, async (route) => {
    state.iv.state = 'thinking'
    state.turns.push({ id: ANSWER, idx: 1, role: 'answer', text: 'The watch stayed with her.', target_slot: null })
    await route.fulfill({ json: {} })
    setTimeout(() => {
      state.iv.state = 'asking'
      state.turns.push({ id: NEXT, idx: 2, role: 'question', text: 'When did she receive it?', target_slot: null })
    }, 500)
  })
  await page.routeWebSocket(/\/api\/interviews\/.*\/stream/, (ws) => {
    ws.onMessage((message) => {
      if (typeof message === 'string' && JSON.parse(message).type === 'end') {
        ws.send(JSON.stringify({ type: 'error' }))
        ws.close()
      }
    })
  })
  await page.goto(`/interview/${INTERVIEW}`)
  await page.getByRole('button', { name: 'start recording', exact: true }).click()
  await expect(page.getByText('recording…', { exact: true })).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: 'finish', exact: true }).click()
  await expect(page.getByText('When did she receive it?', { exact: true })).toBeVisible({ timeout: 10_000 })
  expect(uploaded).toBe(true)
  expect(state.errors).toEqual([])
  expect(state.unexpected).toEqual([])
})
