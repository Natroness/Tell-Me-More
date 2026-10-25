import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { LocateFixed, Minus, Plus } from 'lucide-react'
import { initials } from '@/lib/relations'
import { NODE, type TreeLayout } from '@/lib/treeLayout'
import { cn } from '@/lib/utils'

const MIN = 0.6
const MAX = 1.6
const STEP = 0.2

export function FamilyTreeView({
  layout,
  meId,
  selectedId,
  onSelect,
  avatars,
}: {
  layout: TreeLayout
  meId: string | null
  selectedId: string | null
  onSelect: (id: string) => void
  /** Person id → avatar image, when they picked one. */
  avatars?: Map<string, string | null>
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const keepCenter = useRef<{ x: number; y: number } | null>(null)
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null)

  /** Left edge of the scaled tree inside the canvas, which is at least as wide as the viewport. */
  const offsetX = useCallback(
    (s: number) => Math.max(0, ((canvas.current?.clientWidth ?? 0) - layout.width * s) / 2),
    [layout],
  )

  const centerOn = useCallback(
    (id: string | null, behavior: ScrollBehavior = 'smooth') => {
      const el = viewport.current
      const node = layout.nodes.find((n) => n.id === id)
      if (!el || !node) return
      el.scrollTo({
        left: offsetX(scale) + node.x * scale - el.clientWidth / 2,
        top: node.y * scale - el.clientHeight / 2,
        behavior,
      })
    },
    [layout, scale, offsetX],
  )

  useEffect(() => {
    centerOn(meId, 'auto')
    // Only when the tree itself changes; zooming keeps the current view instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, meId])

  useLayoutEffect(() => {
    const el = viewport.current
    const c = keepCenter.current
    if (!el || !c) return
    el.scrollLeft = offsetX(scale) + c.x * scale - el.clientWidth / 2
    el.scrollTop = c.y * scale - el.clientHeight / 2
    keepCenter.current = null
  }, [scale, offsetX])

  function zoom(delta: number) {
    const el = viewport.current
    const next = Math.min(MAX, Math.max(MIN, Math.round((scale + delta) * 10) / 10))
    if (!el || next === scale) return
    keepCenter.current = {
      x: (el.scrollLeft + el.clientWidth / 2 - offsetX(scale)) / scale,
      y: (el.scrollTop + el.clientHeight / 2) / scale,
    }
    setScale(next)
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'mouse' || !viewport.current) return
    const el = viewport.current
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, moved: false }
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current
    const el = viewport.current
    if (!d || !el) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < 5) return
    d.moved = true
    el.scrollLeft = d.left - dx
    el.scrollTop = d.top - dy
  }

  function endDrag() {
    setTimeout(() => {
      drag.current = null
    })
  }

  const zoomBtn = 'grid size-12 place-items-center disabled:opacity-40'

  return (
    <div>
      <div className="relative">
        <div
          ref={viewport}
          data-testid="family-tree"
          className="hand-box h-[24rem] cursor-grab touch-pan-x touch-pan-y overflow-auto border-2 border-ink active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          onClickCapture={(e) => {
            if (drag.current?.moved) e.stopPropagation()
          }}
        >
          <div
            ref={canvas}
            className="relative mx-auto"
            style={{ width: layout.width * scale, height: layout.height * scale, minWidth: '100%' }}
          >
            <div
              className="absolute top-0 left-1/2 origin-top"
              style={{
                width: layout.width,
                height: layout.height,
                transform: `translateX(-50%) scale(${scale})`,
              }}
            >
              <svg width={layout.width} height={layout.height} className="absolute inset-0 text-ink" aria-hidden>
                {layout.connectors.map((c) => (
                  <path key={c.key} d={c.d} fill="none" stroke="currentColor" strokeWidth={2}
                    strokeDasharray={c.friend ? '1 7' : undefined} strokeLinecap="round"
                    data-kind={c.friend ? 'friend' : 'family'} />
                ))}
              </svg>
              {layout.nodes.map((n) => {
                const isMe = n.id === meId
                const selected = n.id === selectedId
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => onSelect(n.id)}
                    aria-pressed={selected}
                    aria-label={isMe ? `${n.name} (you)` : `${n.name} (${n.role})`}
                    data-person-id={n.id}
                    title={n.name}
                    className="absolute flex w-24 -translate-x-1/2 flex-col items-center gap-1"
                    style={{ left: n.x, top: n.y - NODE / 2 }}
                  >
                    <span className="absolute bottom-full mb-1 max-w-28 rounded bg-paper px-1.5 text-center font-sans text-[1rem] leading-tight text-muted">
                      {n.role}
                    </span>
                    <span
                      className={cn(
                        'grid size-16 place-items-center overflow-hidden rounded-full border-2 border-ink font-hand text-[1.6rem] leading-none',
                        isMe ? 'bg-sun text-black' : 'bg-paper text-ink',
                        selected && 'outline-4 outline-offset-2',
                        selected && (isMe ? 'outline-ink' : 'outline-sun'),
                      )}
                    >
                      {avatars?.get(n.id) ? (
                        <img src={avatars.get(n.id)!} alt="" className="size-full object-cover" />
                      ) : (
                        initials(n.name)
                      )}
                    </span>
                    <span
                      className={cn(
                        'line-clamp-2 max-w-24 rounded-full px-1.5 text-center font-sans text-[1.1rem] leading-[1.05] break-words',
                        isMe && 'bg-sun text-black',
                      )}
                    >
                      {isMe ? 'me' : n.name}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
        <div className="hand-box absolute right-3 bottom-3 flex flex-col overflow-hidden border-2 border-ink bg-paper">
          <button type="button" aria-label="Zoom in" onClick={() => zoom(STEP)} disabled={scale >= MAX} className={zoomBtn}>
            <Plus className="size-6" strokeWidth={2.4} />
          </button>
          <span className="h-0.5 bg-ink" aria-hidden />
          <button type="button" aria-label="Zoom out" onClick={() => zoom(-STEP)} disabled={scale <= MIN} className={zoomBtn}>
            <Minus className="size-6" strokeWidth={2.4} />
          </button>
        </div>
      </div>
      {meId && (
        <button
          type="button"
          onClick={() => {
            onSelect(meId)
            centerOn(meId)
          }}
          className="hand-pill mx-auto mt-3 flex min-h-12 items-center justify-center gap-2 border-2 border-ink px-6 font-sans text-[1.35rem] leading-none"
        >
          <LocateFixed className="size-5" strokeWidth={2.2} aria-hidden />
          center on me
        </button>
      )}
    </div>
  )
}
