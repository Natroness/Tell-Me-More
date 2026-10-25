import type { ReactNode } from 'react'
import { Button, EmptyState, ErrorState, Loading } from '@/components/ui/chrome'
import { useFamily } from '@/lib/family'

/** Renders children once the signed-in user's family is known. */
export function FamilyGate({ children }: { children: (familyId: string) => ReactNode }) {
  const family = useFamily()
  if (family.isPending) return <Loading />
  if (family.isError) return <ErrorState message={family.error.message} onRetry={() => family.refetch()} />
  if (!family.data) {
    return (
      <EmptyState
        title="no family yet"
        action={
          <Button to="/family" tone="secondary">
            open family
          </Button>
        }
      >
        join or start a family to keep shared dates.
      </EmptyState>
    )
  }
  return <>{children(family.data.id)}</>
}
