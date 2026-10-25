import { useNavigate } from 'react-router'
import { BigButton, ScreenHeader } from '@/components/ui/Screen'
import { clearCapture, getCapture } from '@/lib/captureStore'

/** Brief §3C: preview + "Can you see the object clearly?" + Retake/Use + blur flag. */
export function Review() {
  const navigate = useNavigate()
  const cap = getCapture()

  if (!cap) {
    return (
      <main className="mx-auto max-w-xl px-4 py-8">
        <ScreenHeader title="Review" />
        <p className="text-muted">Nothing captured yet.</p>
        <BigButton to="/capture" primary>
          Open camera
        </BigButton>
      </main>
    )
  }

  const blurry = cap.kind === 'photo' && cap.blob.size < 20000

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
      <ScreenHeader title="Review" />
      <h1 className="font-serif text-3xl">Can you see the object clearly?</h1>
      {cap.kind === 'photo' ? (
        <img src={cap.previewUrl} className="rounded-xl" alt="Captured object" />
      ) : (
        <video src={cap.previewUrl} controls playsInline className="rounded-xl" />
      )}
      {blurry && (
        <p className="rounded-xl bg-yellow-50 p-3 text-sm text-yellow-900">
          This looks a little blurry. Try taking it again. You can continue anyway.
        </p>
      )}
      <BigButton
        onClick={() => {
          clearCapture()
          navigate('/capture')
        }}
      >
        Retake
      </BigButton>
      <BigButton
        onClick={() => navigate('/archive')}
        primary
      >
        Use {cap.kind === 'photo' ? 'photo' : 'video'}
      </BigButton>
    </main>
  )
}
