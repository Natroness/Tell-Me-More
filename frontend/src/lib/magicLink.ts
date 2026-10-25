import { supabase } from '@/lib/supabase'

/**
 * Passwordless (magic link) auth, restored alongside the password UI.
 * Uses the original Supabase OTP flow: an email link that returns to the
 * app origin, where Entry routes to onboarding/home (or a stored invite).
 */
export function magicLinkRedirectTo(): string {
  return window.location.origin
}

export async function sendSignInLink(email: string): Promise<string | null> {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: magicLinkRedirectTo() },
  })
  return error ? error.message : null
}

export async function sendSignUpLink(email: string, displayName: string): Promise<string | null> {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: {
      emailRedirectTo: magicLinkRedirectTo(),
      shouldCreateUser: true,
      data: { display_name: displayName.trim() },
    },
  })
  return error ? error.message : null
}
