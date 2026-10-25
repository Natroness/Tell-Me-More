type Draft = { description: string; requestId?: string | null; at?: number }
const draftKey = (heirloomId: string) => `tmm-draft-${heirloomId}`

/** Drafts stay on this phone only; the API has no draft storage. */
export function readDraft(heirloomId: string): Draft | null {
  const raw = localStorage.getItem(draftKey(heirloomId))
  if (!raw) return null
  try {
    const d = JSON.parse(raw) as Partial<Draft>
    return typeof d === 'object' && d ? { ...d, description: d.description ?? '' } : { description: raw }
  } catch {
    return { description: raw }
  }
}

export function writeDraft(heirloomId: string, draft: Draft) {
  localStorage.setItem(draftKey(heirloomId), JSON.stringify({ ...draft, at: Date.now() }))
}

export function clearDraft(heirloomId: string) {
  localStorage.removeItem(draftKey(heirloomId))
}

export function formatMs(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
