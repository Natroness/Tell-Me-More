import type { ReactNode } from 'react'
import { Button, Header } from '@/components/ui/chrome'

/** Legacy names kept so older screens keep working; new code uses `Header` and `Button`. */
export function ScreenHeader({ title, hideBack }: { title: string; hideBack?: boolean }) {
  return <Header title={title} back={hideBack ? false : undefined} />
}

export function BigButton({
  to,
  onClick,
  disabled,
  children,
  primary,
}: {
  to?: string
  onClick?: () => void
  disabled?: boolean
  children: ReactNode
  primary?: boolean
}) {
  return (
    <Button to={to} onClick={onClick} disabled={disabled} tone={primary ? 'primary' : 'secondary'}>
      {children}
    </Button>
  )
}
