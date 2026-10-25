import { Button, EmptyState, Header, ScreenBody } from '@/components/ui/chrome'
import { useScreenTitle } from '@/lib/useScreenTitle'

/** Placeholder that keeps a home tile navigable until its screen ships. */
export function Soon({ title }: { title: string }) {
  useScreenTitle(title)
  return (
    <ScreenBody screen="soon">
      <Header title={title} back="/" />
      <EmptyState title="this shelf is next.">we are still building this part of the family album.</EmptyState>
      <div className="mt-auto pt-8">
        <Button to="/">home →</Button>
      </div>
    </ScreenBody>
  )
}
