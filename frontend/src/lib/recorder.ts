/**
 * Records the mic as 16 kHz mono 16-bit WAV, which is what Muse Voice Transcribe expects
 * (DESIGN.md §5.3). The same file is used for playback on the story page.
 */
const SAMPLE_RATE = 16_000

export type Recording = { stop: () => Promise<Blob>; level: () => number }

export async function startRecording(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  })
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
  await ctx.audioWorklet.addModule('/worklets/pcm-capture.js')
  const source = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'pcm-capture')
  const chunks: Float32Array[] = []
  let lastLevel = 0
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    chunks.push(e.data)
    lastLevel = Math.sqrt(e.data.reduce((s, v) => s + v * v, 0) / e.data.length)
  }
  source.connect(node)

  return {
    level: () => lastLevel,
    async stop() {
      source.disconnect()
      node.disconnect()
      stream.getTracks().forEach((t) => t.stop())
      await ctx.close()
      return encodeWav(chunks, SAMPLE_RATE)
    },
  }
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
    for (const v of chunk) {
      const clamped = Math.max(-1, Math.min(1, v))
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
      offset += 2
    }
  }
  return new Blob([view], { type: 'audio/wav' })
}
