/**
 * Reads interview questions aloud with the phone's own voice. Meta's API has no speech output,
 * and on-device speech starts instantly with no network wait.
 *
 * iPhone Safari speaks only after a first utterance made inside a tap, so call `unlockSpeech`
 * from the tap that starts the interview; later questions can then speak on their own.
 */

let voice: SpeechSynthesisVoice | null | undefined

// The warmest voice the phone has for this language: enhanced or natural ones over the default.
function pickVoice(lang: string): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith(lang))
  const rank = (v: SpeechSynthesisVoice) =>
    (/enhanced|premium|natural|neural/i.test(v.name) ? 4 : 0) +
    (/google|samantha|siri/i.test(v.name) ? 2 : 0) +
    (v.localService ? 1 : 0)
  return voices.sort((a, b) => rank(b) - rank(a))[0] ?? null
}

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function unlockSpeech(): void {
  if (!canSpeak()) return
  speechSynthesis.cancel()
  speechSynthesis.speak(new SpeechSynthesisUtterance(''))
}

/** Resolves when the phone finishes saying it, or is stopped. Never rejects. */
export function speak(text: string, lang = 'en'): Promise<void> {
  if (!canSpeak() || !text.trim()) return Promise.resolve()
  if (voice === undefined || voice === null) voice = pickVoice(lang)
  speechSynthesis.cancel()
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = voice?.lang ?? lang
    if (voice) u.voice = voice
    u.rate = 0.95 // a touch slower than default, for older listeners
    // Some browsers drop `end` on long utterances; never leave the interview waiting on it.
    const fallback = window.setTimeout(done, 2_000 + text.split(/\s+/).length * 450)
    function done() {
      window.clearTimeout(fallback)
      resolve()
    }
    u.onend = done
    u.onerror = done
    speechSynthesis.speak(u)
  })
}

export function stopSpeaking(): void {
  if (canSpeak()) speechSynthesis.cancel()
}

if (canSpeak()) {
  speechSynthesis.addEventListener?.('voiceschanged', () => {
    voice = undefined
  })
}
