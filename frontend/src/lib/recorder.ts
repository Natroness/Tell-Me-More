/**
 * Records the mic as 16 kHz mono 16-bit WAV, which is what Muse Voice Transcribe expects
 * (DESIGN.md §5.3). `onPcm` gets the same audio as raw 16-bit PCM while recording, for streaming.
 * The WAV is the fallback upload if streaming fails.
 */
const SAMPLE_RATE = 16_000

export type Recording = {
  stop: () => Promise<Blob>
  level: () => number
  /** Suspends capture; nothing is recorded or streamed until `resume`. */
  pause: () => Promise<void>
  resume: () => Promise<void>
}

export async function startRecording(onPcm?: (pcm: ArrayBuffer) => void): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  })
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
  try {
    await ctx.audioWorklet.addModule('/worklets/pcm-capture.js')
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop())
    await ctx.close()
    throw error
  }
  const source = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'pcm-capture')
  const chunks: Float32Array[] = []
  let lastLevel = 0
  let paused = false
  let stopped: Promise<Blob> | undefined
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    if (paused || stopped) return
    chunks.push(e.data)
    onPcm?.(toInt16(e.data).buffer as ArrayBuffer)
    lastLevel = Math.sqrt(e.data.reduce((s, v) => s + v * v, 0) / e.data.length)
  }
  source.connect(node)

  return {
    level: () => lastLevel,
    async pause() {
      paused = true
      lastLevel = 0
      await ctx.suspend()
    },
    async resume() {
      await ctx.resume()
      paused = false
    },
    stop: () => stopped ??= (async () => {
      source.disconnect()
      node.disconnect()
      stream.getTracks().forEach((t) => t.stop())
      await ctx.close()
      return encodeWav(chunks, SAMPLE_RATE)
    })(),
  }
}

function toInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length)
  samples.forEach((v, i) => {
    const clamped = Math.max(-1, Math.min(1, v))
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
  })
  return out
}

function encodeWav(chunks: Float32Array[], sampleRate: number): Blob {
  const samples = chunks.reduce((n, c) => n + c.length, 0)
  const view = new DataView(new ArrayBuffer(44 + samples * 2))
  const ascii = (offset: number, s: string) =>
    [...s].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)))
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, samples * 2, true)
  let offset = 44
  for (const chunk of chunks) {
    for (const v of toInt16(chunk)) {
      view.setInt16(offset, v, true)
      offset += 2
    }
  }
  return new Blob([view], { type: 'audio/wav' })
}
