import { readDevSession } from './devAuth'
import { supabase } from './supabase'

const END_TIMEOUT_MS = 12_000

/**
 * Streams an answer's PCM to the backend while the narrator speaks, so the transcript is ready
 * the moment they tap Done. Protocol in backend/app/routers/answer_stream.py.
 */
export type Reply = {
  text: string
  question: { id: string; text: string; number: number } | null
  ended: boolean
}

export type AnswerStream = {
  send: (pcm: ArrayBuffer) => void
  /** Resolves once the transcript is saved; rejects if the caller should upload instead. */
  end: () => Promise<Reply>
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
  let done = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let finishing: Promise<Reply> | undefined
  let settle: { resolve: (reply: Reply) => void; reject: (e: Error) => void } | null = null

  const send = (frame: ArrayBuffer | string) => {
    if (failed || done) return
    if (started) ws.send(frame)
    else pending.push(frame)
  }
  const fail = (why: string) => {
    if (done || failed) return
    failed = true
    clearTimeout(timer)
    pending.length = 0
    settle?.reject(new Error(why))
    ws.close()
  }

  ws.onopen = async () => {
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token ?? readDevSession()?.access_token
      if (failed || done || ws.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify({ type: 'start', token }))
      pending.splice(0).forEach((frame) => ws.send(frame))
      started = true
    } catch {
      fail('connection failed')
    }
  }
  ws.onmessage = (e: MessageEvent<string>) => {
    try {
      const msg = JSON.parse(e.data) as { type: string } & Partial<Reply>
      if (msg.type === 'partial') onPartial(msg.text ?? '')
      else if (msg.type === 'done') {
        done = true
        clearTimeout(timer)
        settle?.resolve({ text: msg.text ?? '', question: msg.question ?? null, ended: !!msg.ended })
      } else if (msg.type === 'error') fail('transcription failed')
    } catch {
      fail('invalid transcription response')
    }
  }
  ws.onerror = () => fail('connection failed')
  ws.onclose = () => fail('connection closed')

  return {
    send,
    end: () => finishing ??= new Promise<Reply>((resolve, reject) => {
        if (failed) return reject(new Error('stream already failed'))
        settle = { resolve, reject }
        send(JSON.stringify({ type: 'end' }))
        // The final transcript normally lands in well under a second; past this, upload instead.
        timer = setTimeout(() => fail('timed out'), END_TIMEOUT_MS)
      }),
    abort: () => fail('cancelled'),
  }
}
