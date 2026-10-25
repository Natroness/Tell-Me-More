import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test as base, expect, type Page } from '@playwright/test'

// Derive empty-state responses from the current backend contract, without starting a worker
// or opening a database connection. All browser API/Auth/Realtime requests below are mocked.
const spec = JSON.parse(execFileSync('uv', [
  'run', 'python', '-c', 'import json; from app.main import app; print(json.dumps(app.openapi()))',
], { cwd: fileURLToPath(new URL('../../backend', import.meta.url)) }).toString())

export const USER = '10000000-0000-4000-8000-000000000001'
export const FAMILY = '10000000-0000-4000-8000-000000000002'
export const OBJECT = '10000000-0000-4000-8000-000000000003'
export const PERSON = '10000000-0000-4000-8000-000000000004'
export const INTERVIEW = '10000000-0000-4000-8000-000000000005'
export const ANSWER = '10000000-0000-4000-8000-000000000006'
export const QUESTION = '10000000-0000-4000-8000-000000000007'
export const NEXT = '10000000-0000-4000-8000-000000000008'

function value(schema: any, key = '', depth = 0): any {
  if (!schema || depth > 12) return null
  if (schema.$ref) return value(spec.components.schemas[schema.$ref.split('/').at(-1)], key, depth + 1)
  if ('default' in schema) return schema.default
  if (schema.anyOf) return value(schema.anyOf.find((s: any) => s.type !== 'null'), key, depth + 1)
  if (schema.enum) return schema.enum[0]
  if (schema.type === 'array') return []
  if (schema.type === 'object' || schema.properties) {
    return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([k, s]) => [k, value(s, k, depth + 1)]))
  }
  if (schema.type === 'boolean') return false
  if (schema.type === 'integer' || schema.type === 'number') return schema.minimum ?? 1
  if (schema.format === 'uuid' || key.endsWith('_id')) return OBJECT
  if (schema.format === 'date-time') return '2026-10-25T12:00:00Z'
  if (schema.format === 'date') return '2026-10-25'
  if (schema.format === 'time') return '12:00:00'
  return key === 'time_zone' ? 'America/Chicago' : `test ${key}`
}

function response(path: string, method = 'get') {
  const schema = spec.paths[path]?.[method]?.responses?.['200']?.content?.['application/json']?.schema
  return value(schema)
}

export function session(userId = USER) {
  const now = Math.floor(Date.now() / 1000)
  const payload = { sub: userId, aud: 'authenticated', role: 'authenticated', iat: now, exp: now + 3600 }
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'), 'browser-test-signature'].join('.')
  return {
    access_token: token, refresh_token: 'browser-test-refresh', token_type: 'bearer',
    expires_in: 3600, expires_at: now + 3600,
    user: { id: userId, aud: 'authenticated', role: 'authenticated', email: 'test@example.invalid',
      app_metadata: {}, user_metadata: {}, created_at: '2026-10-25T12:00:00Z' },
  }
}

export async function mockApp(page: Page, options: { signedIn?: boolean; owner?: boolean; status?: string } = {}) {
  const errors: string[] = []
  const unexpected: string[] = []
  const calls: string[] = []
  const family = { id: FAMILY, name: 'Test family', invite_code: 'test-code' }
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && /Encountered two children|Each child in a list|Maximum update depth|Cannot update a component/.test(message.text())) {
      errors.push(message.text())
    }
  })
  await page.addInitScript(({ signedIn, initial }) => {
    if (signedIn) localStorage.setItem('sb-kzgssclziixnlqejplqo-auth-token', JSON.stringify(initial))
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    ;(window as any).__tracks = []
    ;(window as any).__contexts = []
    const OriginalContext = window.AudioContext
    window.AudioContext = class extends OriginalContext {
      createMediaStreamSource(stream: MediaStream) {
        // Track microphone contexts; the question reader keeps a separate playback context.
        ;(window as any).__contexts.push(this)
        return super.createMediaStreamSource(stream)
      }
    }
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await get(constraints)
      ;(window as any).__tracks.push(...stream.getTracks())
      return stream
    }
  }, { signedIn: options.signedIn ?? true, initial: session() })
  await page.route('https://*.supabase.co/**', (route) => route.fulfill({ json: session().user }))
  await page.routeWebSocket(/supabase\.co\/realtime/, () => {})
  await page.route('**/fixture-video.mp4', (route) => route.fulfill({
    contentType: 'video/mp4', body: readFileSync(new URL('./assets/playback.mp4', import.meta.url)),
  }))
  const story = { ...response('/api/stories/{heirloom_id}'), heirloom_id: OBJECT, title: 'The family watch' }
  const detail = response('/api/heirlooms/{heirloom_id}')
  detail.heirloom = { ...detail.heirloom, id: OBJECT, family_id: FAMILY, title: 'The family watch', cover_url: null }
  detail.latest_story_version = 1
  const video = {
    id: OBJECT, status: options.status ?? 'ready', can_manage: options.owner ?? true,
    video_url: '/fixture-video.mp4', poster_url: null, duration_ms: 30000,
    stale: false, credits: [], error: null,
  }
  const iv = { id: INTERVIEW, heirloom_id: OBJECT, narrator_id: PERSON, language: 'en', state: 'asking', coverage: {}, max_questions: 10 }
  const turns = [{ id: QUESTION, idx: 0, role: 'question', text: 'Where did the watch come from?', target_slot: null }]
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method().toLowerCase()
    calls.push(`${method} ${path}`)
    let data: any
    if (method === 'post' && path === '/api/speech') {
      // Synthetic PCM keeps browser checks offline and avoids calling a paid voice provider.
      return route.fulfill({ contentType: 'audio/L16;rate=24000;channels=1', body: Buffer.alloc(9600) })
    }
    if (method !== 'get') {
      unexpected.push(`${method} ${path}`)
      return route.fulfill({ status: 500, json: { detail: 'Unexpected test mutation' } })
    }
    if (path === '/api/profile') data = { user_id: USER, display_name: 'Morgan', age: 36, ui_mode: 'simplified', ui_mode_is_manual: false, preferred_language: 'en' }
    else if (path === '/api/families') data = [family]
    else if (path.endsWith('/tree')) data = {
      people: [{ id: PERSON, family_id: FAMILY, display_name: 'Morgan', relation: 'you', is_living: true }],
      relationships: [], me: PERSON, member_person_ids: [PERSON],
    }
    else if (path === `/api/heirlooms/${OBJECT}`) data = detail
    else if (path === `/api/stories/${OBJECT}` || path === `/api/public/stories/${OBJECT}`) data = story
    else if (path.endsWith('/storytime')) data = video
    else if (path === '/api/storytime/available') data = { available: true }
    else if (path === `/api/interviews/${INTERVIEW}`) data = iv
    else if (path === `/api/interviews/${INTERVIEW}/turns`) data = turns
    else {
      const pattern = Object.keys(spec.paths).find((candidate) => spec.paths[candidate]?.get
        && new RegExp(`^${candidate.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(path))
      if (!pattern || !spec.paths[pattern]?.get) {
        unexpected.push(`${method} ${path}`)
        return route.fulfill({ status: 404, json: { detail: 'Unknown backend path' } })
      }
      data = response(pattern)
    }
    await route.fulfill({ json: data })
  })
  return { errors, unexpected, calls, video, iv, turns, story, family }
}

export const test = base
export { expect }
