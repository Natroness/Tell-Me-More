// Runs in an AudioContext created with sampleRate 16000, so the browser has already
// resampled the mic. Forwards raw mono Float32 frames to the main thread.
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0]
    if (channel) this.port.postMessage(channel.slice(0))
    return true
  }
}
registerProcessor('pcm-capture', PcmCapture)
