import { supabase } from './supabase'

const END_TIMEOUT_MS = 8_000

/**
 * Streams an answer's PCM to the backend while the narrator speaks, so the transcript is ready
 * the moment they tap Done. Protocol in backend/app/routers/answer_stream.py.
 */
export type AnswerStream = {
  send: (pcm: ArrayBuffer) => void
  /** Resolves once the transcript is saved; rejects if the caller should upload instead. */
  end: () => Promise<void>
  abort: () => void
}

export function openAnswerStream(
  interviewId: string,
  turnId: string,
  onPartial: (text: string) => void,
): AnswerStream {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(
    `${scheme}://${location.host}/api/interviews/${interviewId}/answers/${turnId}/stream`,
  )
  ws.binaryType = 'arraybuffer'
  // Audio recorded before the start message goes out waits here, then follows it in order.
  const pending: (ArrayBuffer | string)[] = []
  let started = false
  let failed = false
  let settle: { resolve: () => void; reject: (e: Error) => void } | null = null

  const send = (frame: ArrayBuffer | string) =>
    started ? ws.send(frame) : pending.push(frame)
  const fail = (why: string) => {
    failed = true
    settle?.reject(new Error(why))
  }

  ws.onopen = async () => {
    const { data } = await supabase.auth.getSession()
    ws.send(JSON.stringify({ type: 'start', token: data.session?.access_token }))
    pending.splice(0).forEach((frame) => ws.send(frame))
    started = true
  }
  ws.onmessage = (e: MessageEvent<string>) => {
    const msg = JSON.parse(e.data) as { type: string; text?: string }
    if (msg.type === 'partial') onPartial(msg.text ?? '')
    else if (msg.type === 'done') settle?.resolve()
    else if (msg.type === 'error') fail('transcription failed')
  }
  ws.onerror = () => fail('connection failed')
  ws.onclose = () => fail('connection closed')

  return {
    send,
    end: () =>
      new Promise<void>((resolve, reject) => {
        if (failed) return reject(new Error('stream already failed'))
        settle = { resolve, reject }
        send(JSON.stringify({ type: 'end' }))
        // The final transcript normally lands in well under a second; past this, upload instead.
        setTimeout(() => fail('timed out'), END_TIMEOUT_MS)
      }),
    abort: () => ws.close(),
  }
}
