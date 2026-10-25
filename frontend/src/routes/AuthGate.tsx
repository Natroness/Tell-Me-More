import { useQueryClient } from '@tanstack/react-query'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router'
import { BootScreen, Button, Header, Notice, ScreenBody } from '@/components/ui/chrome'
import { useAuth } from '@/lib/auth'
import { useProfile } from '@/lib/profile'
import { readReturnTo, rememberReturnTo } from '@/lib/returnTo'
import { supabaseConfigured } from '@/lib/supabase'
import { Home } from '@/routes/Home'
import { Welcome } from '@/routes/Welcome'

function waitingOnProfile(hasSession: boolean, hasData: boolean, isError: boolean) {
  return hasSession && !hasData && !isError
}

export function ProfileError({ detail }: { detail?: string }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { signOut } = useAuth()

  async function logout() {
    try {
      await signOut()
    } catch {
      /* still leave the broken session */
    }
    qc.clear()
    navigate('/', { replace: true })
  }

  return (
    <ScreenBody screen="account-error">
      <Header title="tell me more" back={false} />
      <Notice tone="error" title="we couldn't open your account">
        {detail ?? 'we could not load your account from the server.'}
      </Notice>
      <div className="mt-auto flex flex-col gap-3 pt-8">
        <Button onClick={() => qc.invalidateQueries({ queryKey: ['profile'] })}>try again →</Button>
        <Button tone="secondary" onClick={logout}>
          sign out
        </Button>
      </div>
    </ScreenBody>
  )
}

/** `/` is the welcome screen until a session exists, then home after onboarding. */
export function Entry() {
  const { ready, session, devSession } = useAuth()
  const profile = useProfile()
  const canUseAccount = supabaseConfigured || !!devSession

  if (!ready) return <BootScreen />
  if (!session) return <Welcome />
  if (!canUseAccount) return <ProfileError detail="sign-in is not available right now. please try again later." />
  if (waitingOnProfile(true, !!profile.data, profile.isError)) return <BootScreen />
  if (profile.isError) return <ProfileError detail={profile.error.message} />
  if (profile.data?.age == null) return <Navigate to="/onboarding" replace />
  const returnTo = readReturnTo()
  if (returnTo) return <Navigate to={returnTo} replace />
  return <Home />
}

export function PublicOnly() {
  const location = useLocation()
  const { ready, session, devSession } = useAuth()
  const profile = useProfile()
  const editing = Boolean((location.state as { editing?: boolean } | null)?.editing)
  const canUseAccount = supabaseConfigured || !!devSession

  if (!ready) return <BootScreen />
  if (!session) return <Outlet />
  if (editing && location.pathname === '/sign-up') return <Outlet />
  if (!canUseAccount) return <ProfileError detail="sign-in is not available right now. please try again later." />
  if (waitingOnProfile(true, !!profile.data, profile.isError)) return <BootScreen />
  if (profile.isError) return <ProfileError detail={profile.error.message} />
  if (profile.data?.age == null) return <Navigate to="/onboarding" replace />
  return <Navigate to="/" replace />
}

export function RequireAuth() {
  const location = useLocation()
  const { ready, session } = useAuth()
  if (!ready) return <BootScreen />
  if (!session) {
    rememberReturnTo(location.pathname)
    return <Navigate to="/welcome" replace />
  }
  return <Outlet />
}

export function RequireOnboarding() {
  const location = useLocation()
  const { devSession } = useAuth()
  const profile = useProfile()
  const canUseAccount = supabaseConfigured || !!devSession
  if (!canUseAccount) return <ProfileError detail="sign-in is not available right now. please try again later." />
  if (waitingOnProfile(true, !!profile.data, profile.isError)) return <BootScreen />
  if (profile.isError) return <ProfileError detail={profile.error.message} />
  if (profile.data?.age == null) {
    rememberReturnTo(location.pathname)
    return <Navigate to="/onboarding" replace />
  }
  return <Outlet />
}
