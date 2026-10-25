import { useNavigate } from 'react-router'
import { Button, EmptyState, Header, Notice, ScreenBody } from '@/components/ui/chrome'
import { clearCapture, getCapture } from '@/lib/captureStore'
import { useScreenTitle } from '@/lib/useScreenTitle'

/** Screen 07: is the object clear? Retake or use it. */
export function Review() {
  useScreenTitle('is it clear?')
  const navigate = useNavigate()
  const cap = getCapture()

  if (!cap) {
    return (
      <ScreenBody screen="review-capture">
        <Header title="is it clear?" back="/capture" />
        <EmptyState title="nothing captured yet" action={<Button to="/capture">open camera</Button>} />
      </ScreenBody>
    )
  }

  const blurry = cap.kind === 'photo' && cap.blob.size < 20000

  return (
    <ScreenBody screen="review-capture">
      <Header title="is it clear?" back="/capture" />
      <div className="hand-box overflow-hidden border-2 border-ink">
        {cap.kind === 'photo' ? (
          <img src={cap.previewUrl} className="aspect-square w-full object-cover" alt="your photo of the object" />
        ) : (
          <video src={cap.previewUrl} controls playsInline className="aspect-square w-full bg-ink object-contain" />
        )}
      </div>
      <p className="mt-3 text-center font-sans text-[1.25rem] leading-snug">
        can you see the whole object clearly?
      </p>
      {blurry && (
        <Notice className="mt-3" title="a little blurry">
          try taking it again in good light. you can still continue.
        </Notice>
      )}
      <div className="mt-auto grid grid-cols-2 gap-3 pt-6">
        <Button
          tone="secondary"
          className="px-3"
          onClick={() => {
            clearCapture()
            navigate('/capture')
          }}
        >
          retake
        </Button>
        <Button className="px-3" onClick={() => navigate('/archive')}>
          use {cap.kind}
        </Button>
      </div>
    </ScreenBody>
  )
}
