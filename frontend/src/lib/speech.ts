/**
 * Reads interview questions aloud. English questions stream in Gemini's natural voice from
 * `/api/speech` and start playing within about a second, before the whole clip exists. The phone's
 * own voice takes over when that fails, is slow to start, or the language isn't English.
 *
 * iPhone Safari plays audio only after a tap. Any tap in the app unlocks the natural voice, and
 * `unlockSpeech` (call it from the tap that starts the interview) unlocks the phone's voice too.
 */
import { api } from './api'

// Past this with no sound, the phone's own voice beats more silence.
const FIRST_AUDIO_MS = 4_000
// Seconds of audio per scheduled buffer: fewer seams to click at, still far ahead of playback.
const BATCH_SECONDS = 0.2

let context: AudioContext | null = null
let playback: AbortController | null = null
let voice: SpeechSynthesisVoice | null | undefined

function audioContext(): AudioContext | null {
  if (!context && typeof AudioContext !== 'undefined') context = new AudioContext()
  return context
}

// iPhone mutes Web Audio with the silent switch unless the page says it is playing on purpose.
// Back to `auto` whenever we stop, so the microphone gets its usual session.
function audioSession(type: 'auto' | 'playback') {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
  if (session) session.type = type
}

function pcmBuffer(ctx: AudioContext, bytes: Uint8Array, rate: number): AudioBuffer {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const buffer = ctx.createBuffer(1, bytes.byteLength / 2, rate)
  const samples = buffer.getChannelData(0)
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768
  return buffer
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

/** True when it played or was stopped; false when nothing played and the phone should speak. */
async function speakNaturally(text: string, signal: AbortSignal): Promise<boolean> {
  const ctx = audioContext()
  // Not unlocked by a tap yet: the audio would play to nobody.
  if (ctx?.state !== 'running') return false
  const request = new AbortController()
  const sources: AudioBufferSourceNode[] = []
  const stop = () => {
    request.abort()
    sources.forEach((s) => s.stop())
  }
  signal.addEventListener('abort', stop, { once: true })
  const slow = window.setTimeout(() => request.abort(), FIRST_AUDIO_MS)
  let at = 0
  try {
    const { data, response } = await api.POST('/api/speech', {
      body: { text },
      parseAs: 'stream',
      signal: request.signal,
    })
    if (!data) return false
    const rate = Number(/rate=(\d+)/.exec(response.headers.get('content-type') ?? '')?.[1]) || 24_000
    const reader = data.getReader()
    let pending: Uint8Array = new Uint8Array(0)
    for (let done = false; !done;) {
      const next = await reader.read()
      done = next.done
      if (next.value) pending = concat(pending, next.value)
      const whole = pending.length - (pending.length % 2)
      if (!whole || (!done && whole < rate * 2 * BATCH_SECONDS)) continue
      if (!sources.length) {
        window.clearTimeout(slow)
        audioSession('playback')
        at = ctx.currentTime + 0.05
      }
      // A network stall leaves a gap rather than overlapping late audio.
      at = Math.max(at, ctx.currentTime)
      const source = ctx.createBufferSource()
      source.buffer = pcmBuffer(ctx, pending.subarray(0, whole), rate)
      source.connect(ctx.destination)
      source.start(at)
      at += source.buffer.duration
      sources.push(source)
      pending = pending.slice(whole)
    }
  } catch {
    // Cut off mid-question: let what already arrived finish.
  } finally {
    window.clearTimeout(slow)
  }
  if (!sources.length) return signal.aborted
  if (!signal.aborted) {
    await new Promise<void>((resolve) => {
      const end = window.setTimeout(resolve, (at - ctx.currentTime) * 1000 + 100)
      signal.addEventListener('abort', () => {
        window.clearTimeout(end)
        resolve()
      }, { once: true })
    })
  }
  signal.removeEventListener('abort', stop)
  if (playback?.signal === signal) audioSession('auto')
  return true
}

// The warmest voice the phone has for this language: enhanced or natural ones over the default.
function pickVoice(lang: string): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith(lang))
  const rank = (v: SpeechSynthesisVoice) =>
    (/enhanced|premium|natural|neural/i.test(v.name) ? 4 : 0) +
    (/google|samantha|siri/i.test(v.name) ? 2 : 0) +
    (v.localService ? 1 : 0)
  return voices.sort((a, b) => rank(b) - rank(a))[0] ?? null
}

function speakOnDevice(text: string, lang: string): Promise<void> {
  if (!canSpeak()) return Promise.resolve()
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

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function unlockSpeech(): void {
  void audioContext()?.resume()
  if (!canSpeak()) return
  speechSynthesis.cancel()
  speechSynthesis.speak(new SpeechSynthesisUtterance(''))
}

/** Resolves when the question has been said, or is stopped. Never rejects. */
export async function speak(text: string, lang = 'en'): Promise<void> {
  stopSpeaking()
  if (!text.trim()) return
  const current = new AbortController()
  playback = current
  if (lang.startsWith('en') && (await speakNaturally(text, current.signal))) return
  if (!current.signal.aborted) await speakOnDevice(text, lang)
}

export function stopSpeaking(): void {
  playback?.abort()
  playback = null
  audioSession('auto')
  if (canSpeak()) speechSynthesis.cancel()
}

if (typeof window !== 'undefined') {
  // Any tap unlocks the natural voice, so the first question can speak without a tap of its own.
  const unlock = () => void audioContext()?.resume()
  for (const type of ['touchend', 'click', 'keydown']) {
    window.addEventListener(type, unlock, { capture: true, passive: true })
  }
}

if (canSpeak()) {
  speechSynthesis.addEventListener?.('voiceschanged', () => {
    voice = undefined
  })
}
