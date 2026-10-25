/**
 * A tap felt in the hand when recording starts or stops. Call it first thing in the click
 * handler, before any await: browsers only allow haptics during the tap itself.
 *
 * Android: the Vibration API. iPhone Safari has none, but toggling a native switch control
 * gives the system tick (iOS 17.4+), so we click a hidden one. Haptics are decoration: any
 * failure is silent.
 */

export const HAPTIC = {
  start: [30],
  stop: [40, 60, 40],
} as const

export function buzz(pattern: readonly number[]): void {
  try {
    if ('vibrate' in navigator && navigator.vibrate([...pattern])) return
    tick(pattern.length > 1 ? 2 : 1)
  } catch {
    // Unsupported or blocked.
  }
}

function tick(times: number) {
  const label = document.createElement('label')
  label.ariaHidden = 'true'
  label.style.display = 'none'
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.setAttribute('switch', '')
  label.appendChild(input)
  document.body.appendChild(label)
  for (let i = 0; i < times; i++) label.click()
  label.remove()
}
