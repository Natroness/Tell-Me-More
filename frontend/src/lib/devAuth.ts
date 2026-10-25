/**
 * Testing-only email-only login (no password, no email link).
 * Enabled with VITE_DEV_PASSWORDLESS_LOGIN=true + backend DEV_PASSWORDLESS_LOGIN=true.
 * Stores the dev bearer token from POST /api/dev/login in localStorage; api.ts and
 * auth.tsx pick it up as a fallback when there is no Supabase session.
 */

export const devLoginEnabled = import.meta.env.VITE_DEV_PASSWORDLESS_LOGIN === 'true'

const KEY = 'lorebook.dev-session'

export type DevSession = {
  email: string
  access_token: string
  user_id: string
}

export function readDevSession(): DevSession | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DevSession
    if (!parsed?.access_token || !parsed?.user_id || !parsed?.email) return null
    return parsed
  } catch {
    return null
  }
}

export function writeDevSession(session: DevSession) {
  localStorage.setItem(KEY, JSON.stringify(session))
}

export function clearDevSession() {
  localStorage.removeItem(KEY)
}

export async function requestDevLogin(email: string): Promise<DevSession> {
  const res = await fetch('/api/dev/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim() }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(
      res.status === 404
        ? 'dev login is not enabled on the backend. set DEV_PASSWORDLESS_LOGIN=true and restart.'
        : detail || `dev login failed: ${res.status}`,
    )
  }
  const data = (await res.json()) as DevSession
  const session = { email: email.trim(), access_token: data.access_token, user_id: data.user_id }
  writeDevSession(session)
  return session
}
