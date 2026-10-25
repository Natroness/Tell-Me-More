import { Link } from 'react-router'
import family from '@/image/welcome-family.png'
import { InviteNote, PaperScreen, paperButton } from '@/components/ui/chrome'
import { useScreenTitle } from '@/lib/useScreenTitle'

export function Welcome() {
  useScreenTitle('tell me more')
  return (
    <PaperScreen screen="welcome" className="items-center text-center">
      <h1 className="font-['Schoolbell',cursive] text-[3.4rem] leading-none">tell me more</h1>
      <div className="flex min-h-0 w-full flex-1 items-center justify-center py-6">
        <img
          src={family}
          alt="a father carrying his son on his shoulders, holding hands with his grandfather, who walks with a cane"
          className="h-auto max-h-[46dvh] w-auto max-w-full"
        />
      </div>
      <p className="font-['Schoolbell',cursive] text-[2.2rem] leading-[1.1]">
        keep their stories
        <br />
        close.
      </p>
      <div className="mt-8 flex w-full flex-col gap-4">
        <InviteNote className="border-[#FFD43B]" />
        <Link to="/sign-up" className={`${paperButton} bg-[#FFD43B]`}>
          get started →
        </Link>
        <Link to="/sign-in" className={`${paperButton} bg-[#fff]`}>
          sign in
        </Link>
      </div>
    </PaperScreen>
  )
}
