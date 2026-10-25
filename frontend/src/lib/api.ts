import createClient, { type Middleware } from 'openapi-fetch'
import type { components, paths } from '@/api-types'
import { readDevSession } from './devAuth'
import { supabase } from './supabase'

const auth: Middleware = {
  async onRequest({ request }) {
    const { data } = await supabase.auth.getSession()
    if (data.session) {
      request.headers.set('Authorization', `Bearer ${data.session.access_token}`)
      return request
    }
    // Testing-only email-only login fallback (no Supabase session).
    const dev = readDevSession()
    if (dev) request.headers.set('Authorization', `Bearer ${dev.access_token}`)
    return request
  },
}

/** Typed client generated from FastAPI's OpenAPI spec. Run `make types` after backend changes. */
export const api = createClient<paths>({ baseUrl: '' })
api.use(auth)

export type Schemas = components['schemas']

/** Uploads a file body to a Supabase signed upload URL minted by the backend. */
export async function putToSignedUrl(url: string, body: Blob) {
  const res = await fetch(url, {
    method: 'PUT',
    body,
    headers: {
      'Content-Type': body.type,
      'x-upsert': 'true',
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
  })
  if (!res.ok) throw new Error(`upload failed: ${res.status}`)
}
