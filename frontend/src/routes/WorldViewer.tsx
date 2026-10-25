import { useQuery } from '@tanstack/react-query'
import { SparkControls, SparkRenderer, SplatMesh } from '@sparkjsdev/spark'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import * as THREE from 'three'
import { api, type Schemas } from '@/lib/api'

// Loaded only from the lazy /w routes, so three and Spark stay out of the main bundle
// (docs/IMMERSIVE.md §8.4).

type World = Schemas['ImmersiveWorld']
type Spot = World['spots'][number]
type Clip = Spot['segments'][number]

const SPOT_DISTANCE_M = 2

/**
 * Direction from the panorama centre to a point on the equirectangular pano, in three.js world
 * axes (camera looks down -Z). u = 0.5 is straight ahead and u = 0.75 is +X, checked against a
 * live Marble world (DESIGN.md §3.4).
 */
function spotDirection(u: number, v: number): THREE.Vector3 {
  const yaw = (u - 0.5) * 2 * Math.PI
  const pitch = (0.5 - v) * Math.PI
  return new THREE.Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
  )
}

function onPhone() {
  return window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 768
}

export function WorldViewer() {
  const { worldId, heirloomId } = useParams() as { worldId: string; heirloomId?: string }
  const [search] = useSearchParams()
  const k = search.get('k')
  const world = useQuery({
    queryKey: ['world', worldId, k],
    queryFn: async () =>
      k
        ? (await api.GET('/api/public/immersive/{world_id}', {
            params: { path: { world_id: worldId }, query: { k } },
          })).data
        : (await api.GET('/api/immersive/{world_id}', {
            params: { path: { world_id: worldId } },
          })).data,
  })
  const back = heirloomId ? `/s/${heirloomId}${k ? `?k=${encodeURIComponent(k)}` : ''}` : -1

  if (world.isLoading) return <Shell back={back}>Opening the memory…</Shell>
  if (!world.data) return <Shell back={back}>This world isn’t available.</Shell>
  if (world.data.status !== 'ready')
    return <Shell back={back}>This world is still being built. Come back in a few minutes.</Shell>
  return <Walk world={world.data} back={back} />
}

function Shell({ back, children }: { back: string | number; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-ink px-6 text-center text-paper">
      <p className="text-2xl">{children}</p>
      <BackLink back={back} />
    </main>
  )
}

function BackLink({ back }: { back: string | number }) {
  return (
    <Link
      to={back as string}
      className="rounded-full bg-paper/90 px-5 py-3 text-lg text-ink shadow"
    >
      Back to the story
    </Link>
  )
}

function worldAssetForDetail(assets: Record<string, string>, highDetail: boolean) {
  return (highDetail ? assets.spz_500k : assets.spz_100k) ?? assets.spz_500k ?? assets.spz_100k
}

function Walk({ world, back }: { world: World; back: string | number }) {
  const mount = useRef<HTMLDivElement>(null)
  const spotEls = useRef(new Map<string, HTMLButtonElement>())
  const resetView = useRef<() => void>(() => {})
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = useState<Spot | null>(null)
  const [listing, setListing] = useState(false)
  const [highDetail, setHighDetail] = useState(() => !onPhone())
  const [loadError, setLoadError] = useState(false)
  const placed = world.spots.filter((s) => s.u != null && s.v != null)
  const unplaced = world.spots.filter((s) => s.u == null || s.v == null)

  useEffect(() => {
    const el = mount.current!
    const url = worldAssetForDetail(world.assets, highDetail)
    if (!url) {
      setLoadError(true)
      return
    }
    let active = true
    setLoaded(false)
    setLoadError(false)
    // docs.worldlabs.ai/api/rendering-spz: metres = raw x metric_scale_factor, the ground sits
    // at y = ground_plane_offset below the panorama's centre, and Marble's raw OpenCV axes turn
    // into three's by a half turn around X.
    const scale = world.semantics.metric_scale_factor ?? 1
    const eye = new THREE.Vector3(0, world.semantics.ground_plane_offset ?? 0, 0)

    const renderer = new THREE.WebGLRenderer({ antialias: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(el.clientWidth, el.clientHeight)
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const spark = new SparkRenderer({ renderer })
    scene.add(spark)
    const camera = new THREE.PerspectiveCamera(70, el.clientWidth / el.clientHeight, 0.01, 1000)

    const splat = new SplatMesh({ url })
    splat.quaternion.set(1, 0, 0, 0)
    splat.scale.setScalar(scale)
    splat.position.copy(eye)
    scene.add(splat)
    splat.initialized
      .then(() => { if (active) setLoaded(true) })
      .catch(() => { if (active) setLoadError(true) })

    const controls = new SparkControls({ canvas: renderer.domElement })
    // Start where the panorama was taken, looking at its centre.
    resetView.current = () => {
      camera.position.copy(eye)
      camera.quaternion.identity()
    }
    resetView.current()

    const anchors = placed.map((s) => ({
      id: s.id,
      at: spotDirection(s.u!, s.v!).multiplyScalar(SPOT_DISTANCE_M).add(eye),
    }))
    const screen = new THREE.Vector3()
    renderer.setAnimationLoop(() => {
      controls.update(camera)
      renderer.render(scene, camera)
      const w = el.clientWidth
      const h = el.clientHeight
      for (const a of anchors) {
        const button = spotEls.current.get(a.id)
        if (!button) continue
        screen.copy(a.at).project(camera)
        const visible = screen.z < 1 && Math.abs(screen.x) < 1.1 && Math.abs(screen.y) < 1.1
        button.style.display = visible ? 'flex' : 'none'
        if (visible)
          button.style.transform = `translate(${((screen.x + 1) / 2) * w}px, ${((1 - screen.y) / 2) * h}px) translate(-50%, -50%)`
      }
    })

    const resize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight)
      camera.aspect = el.clientWidth / el.clientHeight
      camera.updateProjectionMatrix()
    }
    window.addEventListener('resize', resize)
    return () => {
      active = false
      window.removeEventListener('resize', resize)
      renderer.setAnimationLoop(null)
      scene.remove(splat)
      splat.dispose()
      spark.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
    // The world doesn't change while it's open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world.id, highDetail])

  return (
    <main className="fixed inset-0 overflow-hidden bg-ink text-paper">
      <div ref={mount} className="absolute inset-0 touch-none" />
      {loadError && (
        <p role="alert" className="absolute inset-x-4 top-24 rounded-xl bg-ink/90 p-4 text-center">
          This detail level could not load. Try the other detail level or return to the story.
        </p>
      )}
      {!loaded && !loadError && world.assets.thumbnail && (
        <img
          src={world.assets.thumbnail}
          alt=""
          className="absolute inset-0 size-full object-cover opacity-70 blur-sm"
        />
      )}
      {!loaded && !loadError && (
        <p role="status" className="absolute inset-x-0 top-1/2 text-center text-2xl">
          Opening the memory…
        </p>
      )}

      {placed.map((s) => (
        <button
          key={s.id}
          ref={(b) => {
            if (b) spotEls.current.set(s.id, b)
            else spotEls.current.delete(s.id)
          }}
          onClick={() => setOpen(s)}
          style={{ display: 'none' }}
          className="absolute top-0 left-0 flex min-h-12 min-w-12 items-center gap-2 rounded-full bg-memory/90 px-4 py-3 text-lg font-semibold text-paper shadow-lg"
        >
          <span className="size-3 animate-ping rounded-full bg-paper" />
          {s.label}
        </button>
      ))}

      <header className="absolute inset-x-0 top-0 bg-ink/70 px-4 py-3 text-center text-lg backdrop-blur">
        {world.label}
        {world.reference && (
          <p className="text-sm opacity-80">
            Setting based on{' '}
            {world.reference.kind === 'generated' ? (
              'an AI-generated image of a similar setting'
            ) : (
              <a href={world.reference.page_url ?? undefined} target="_blank" rel="noreferrer" className="underline">
                a public photo of a similar place
              </a>
            )}
          </p>
        )}
      </header>

      <footer className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-center gap-3 p-4 pb-8">
        <BackLink back={back} />
        {world.assets.spz_100k && world.assets.spz_500k && (
          <button
            type="button" onClick={() => setHighDetail((value) => !value)}
            className="rounded-full bg-paper/90 px-5 py-3 text-lg text-ink shadow"
          >
            {highDetail ? 'Fast preview' : 'Higher detail'}
          </button>
        )}
        <button
          onClick={() => resetView.current()}
          className="rounded-full bg-paper/90 px-5 py-3 text-lg text-ink shadow"
        >
          Reset view
        </button>
        {unplaced.length > 0 && (
          <button
            onClick={() => setListing(true)}
            className="rounded-full bg-memory px-5 py-3 text-lg text-paper shadow"
          >
            Memories in this place ({unplaced.length})
          </button>
        )}
      </footer>

      {listing && (
        <Sheet onClose={() => setListing(false)}>
          <h2 className="font-serif text-2xl">Memories in this place</h2>
          <ul className="mt-4 flex flex-col gap-2">
            {unplaced.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => {
                    setListing(false)
                    setOpen(s)
                  }}
                  className="w-full rounded-xl bg-white px-4 py-4 text-left text-lg shadow"
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </Sheet>
      )}
      {open && (
        <Sheet onClose={() => setOpen(null)}>
          <SpotDetail spot={open} narrator={world.narrator} />
        </Sheet>
      )}
    </main>
  )
}

function Sheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-20 flex items-end bg-ink/40"
      onClick={onClose}
    >
      <div
        className="mx-auto max-h-[80dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-paper p-6 pb-10 text-ink"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
        <button onClick={onClose} className="mt-6 w-full rounded-xl border border-ink/20 py-3 text-lg">
          Close
        </button>
      </div>
    </div>
  )
}

/** A spot's memory: what the story says, and the narrator's own voice saying it. */
function SpotDetail({ spot, narrator }: { spot: Spot; narrator: string | null }) {
  const audio = useRef<HTMLAudioElement>(null)
  const endMs = useRef(0)
  const [playing, setPlaying] = useState<string | null>(null)

  useEffect(() => () => audio.current?.pause(), [])

  // iPhone Safari plays only inside the tap, so play first and seek once the clip is known.
  function play(clip: Clip) {
    const el = audio.current!
    endMs.current = clip.end_ms
    if (el.dataset.src !== clip.audio_url) {
      el.src = clip.audio_url
      el.dataset.src = clip.audio_url
    }
    const seek = () => {
      el.currentTime = clip.start_ms / 1000
    }
    if (el.readyState >= 1) seek()
    else el.addEventListener('loadedmetadata', seek, { once: true })
    setPlaying(clip.id)
    el.play().catch(() => setPlaying(null))
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-serif text-3xl">{spot.label}</h2>
      {spot.facts.map((f) => (
        <p key={f.id} className="text-lg leading-relaxed">
          {f.text}
        </p>
      ))}
      {spot.segments.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-muted">{narrator ?? 'The storyteller'} said:</p>
          {spot.segments.map((c) => (
            <button
              key={c.id}
              onClick={() => (playing === c.id ? audio.current?.pause() : play(c))}
              className="flex items-start gap-3 rounded-xl border-l-4 border-memory bg-white p-4 text-left shadow"
            >
              <span className="text-2xl">{playing === c.id ? '❚❚' : '▶'}</span>
              <span className="font-serif text-xl italic">“{c.text_en ?? c.text}”</span>
            </button>
          ))}
        </div>
      )}
      <p className="rounded bg-ink/5 px-2 py-1 text-xs text-muted">
        From {narrator ?? 'the storyteller'}’s interview. The place around it is imagined.
      </p>
      <audio
        ref={audio}
        preload="none"
        onPause={() => setPlaying(null)}
        onEnded={() => setPlaying(null)}
        onTimeUpdate={(e) => {
          if (e.currentTarget.currentTime * 1000 >= endMs.current) e.currentTarget.pause()
        }}
      />
    </div>
  )
}
