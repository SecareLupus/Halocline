import type { PlayerState } from '@halocline/core'
import type { OverlayDocument } from '@halocline/core/overlay'
import {
  boundsOf,
  HANDLES,
  hitTest,
  inMarquee,
  mountOverlay,
  resizeBox,
  SAMPLES,
  sampleState,
  snapMove,
  snapTargets,
  spanBox,
  translateElements,
  updateElement,
  type Box,
  type Guide,
  type Handle,
  type OverlayView,
  type Point,
  type SampleName,
} from '@halocline/overlay'
import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js'
import type { OnEdit } from './overlay-edit'

type Sample = SampleName | 'live'

/** Sample art is a data URI; local cover art is served over artwork://; cloud art is a URL. */
const previewArtwork = (artwork: string) =>
  artwork.startsWith('https://') || artwork.startsWith('data:') ? artwork : `artwork://${artwork}`

/** Snapping reaches this far on screen, whatever the zoom. */
const SNAP_PX = 6
/** A press that moves less than this on screen is a click, not a drag. */
const DRAG_PX = 3

const CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
}
const HANDLE_AT: Record<Handle, [number, number]> = {
  nw: [0, 0],
  n: [50, 0],
  ne: [100, 0],
  e: [100, 50],
  se: [100, 100],
  s: [50, 100],
  sw: [0, 100],
  w: [0, 50],
}

type Drag =
  | { kind: 'move'; start: Point; base: OverlayDocument; ids: string[]; moved: boolean }
  | {
      kind: 'resize'
      start: Point
      base: OverlayDocument
      id: string
      handle: Handle
      moved: boolean
    }
  | { kind: 'marquee'; start: Point; initial: string[] }

/**
 * The overlay drawn by the same renderer OBS uses (PLAN §8), with a sample song or
 * what's playing, and edited in place: click or drag a marquee to select (Shift
 * adds), drag to move, pull a handle to resize (Shift keeps the shape). Edges and
 * centres snap to the canvas and the other elements; Alt turns snapping off.
 */
export function OverlayPreview(props: {
  doc: OverlayDocument
  player: PlayerState | null
  selection: string[]
  onSelect: (ids: string[]) => void
  onEdit: OnEdit
}) {
  const [sample, setSample] = createSignal<Sample>('playing')
  const [guides, setGuides] = createSignal<Guide[]>([])
  const [marquee, setMarquee] = createSignal<Box | null>(null)
  const stateFor = (s: Sample) => (s === 'live' ? props.player : sampleState(s))
  let root: HTMLDivElement | undefined
  let stage: HTMLDivElement | undefined
  let view: OverlayView | undefined
  let drag: Drag | null = null

  onMount(() => {
    view = mountOverlay(root!, props.doc, { artworkUrl: previewArtwork })
    view.setState(stateFor(sample()))
  })
  onCleanup(() => view?.destroy())
  createEffect(
    on(
      () => props.doc,
      (doc) => view?.setDocument(doc),
      { defer: true },
    ),
  )
  createEffect(
    on([sample, () => props.player], ([s]) => view?.setState(stateFor(s)), { defer: true }),
  )

  const canvas = () => props.doc.canvas
  const selectionBox = () =>
    boundsOf(props.doc.elements.filter((e) => props.selection.includes(e.id)))
  const percent = (n: number, of: number) => `${(n / of) * 100}%`
  const boxStyle = (b: Box) => ({
    left: percent(b.x, canvas().width),
    top: percent(b.y, canvas().height),
    width: percent(b.width, canvas().width),
    height: percent(b.height, canvas().height),
  })
  const nothingPlaying = () => sample() === 'live' && (!props.player?.current || props.player.ad)

  /** Screen pixels per canvas pixel. */
  const scale = () => stage!.getBoundingClientRect().width / canvas().width
  const toCanvas = (e: PointerEvent): Point => {
    const r = stage!.getBoundingClientRect()
    return {
      x: ((e.clientX - r.left) / r.width) * canvas().width,
      y: ((e.clientY - r.top) / r.height) * canvas().height,
    }
  }
  const othersThan = (doc: OverlayDocument, ids: string[]) =>
    doc.elements.filter((e) => !ids.includes(e.id))

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    const workspace = e.currentTarget as HTMLElement
    workspace.focus()
    workspace.setPointerCapture(e.pointerId)
    const start = toCanvas(e)
    const handle = (e.target as HTMLElement).dataset.handle as Handle | undefined
    const [only] = props.selection
    if (handle && only && props.selection.length === 1) {
      drag = { kind: 'resize', start, base: props.doc, id: only, handle, moved: false }
      return
    }
    const adding = e.shiftKey || e.ctrlKey || e.metaKey
    const hit = hitTest(props.doc, start)
    if (!hit) {
      drag = { kind: 'marquee', start, initial: adding ? props.selection : [] }
      if (!adding) props.onSelect([])
      return
    }
    let ids = props.selection
    if (adding) {
      ids = ids.includes(hit) ? ids.filter((id) => id !== hit) : [...ids, hit]
      props.onSelect(ids)
      // Shift-clicking a selected element only deselects it.
      if (!ids.includes(hit)) return
    } else if (!ids.includes(hit)) {
      ids = [hit]
      props.onSelect(ids)
    }
    drag = { kind: 'move', start, base: props.doc, ids, moved: false }
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!drag) return
    const at = toCanvas(e)
    const dx = at.x - drag.start.x
    const dy = at.y - drag.start.y
    if (drag.kind === 'marquee') {
      const box = spanBox(drag.start, at)
      setMarquee(box)
      props.onSelect([...new Set([...drag.initial, ...inMarquee(props.doc, box)])])
      return
    }
    if (!drag.moved && Math.hypot(dx, dy) * scale() < DRAG_PX) return
    drag.moved = true
    const threshold = SNAP_PX / scale()
    if (drag.kind === 'move') {
      const { base, ids } = drag
      const targets = e.altKey ? null : snapTargets(canvas(), othersThan(base, ids))
      const bounds = boundsOf(base.elements.filter((el) => ids.includes(el.id)))!
      const moved = snapMove(bounds, dx, dy, targets, threshold)
      setGuides(moved.guides)
      props.onEdit(translateElements(base, ids, moved.dx, moved.dy), { live: true })
    } else {
      const { base, id, handle } = drag
      const element = base.elements.find((el) => el.id === id)!
      const targets = e.altKey ? null : snapTargets(canvas(), othersThan(base, [id]))
      const resized = resizeBox(element, handle, dx, dy, {
        targets,
        threshold,
        keepRatio: e.shiftKey,
      })
      setGuides(resized.guides)
      props.onEdit(updateElement(base, id, resized.box), { live: true })
    }
  }

  // A finished move or resize is one undo step, back to where it started.
  const endDrag = () => {
    if (drag && drag.kind !== 'marquee' && drag.moved) {
      props.onEdit(props.doc, { before: drag.base })
    }
    drag = null
    setGuides([])
    setMarquee(null)
  }

  return (
    <div class="overlay-preview">
      <div class="segmented" role="radiogroup" aria-label="Preview with">
        <For each={[...SAMPLES, { name: 'live' as const, label: 'Now playing' }]}>
          {(s) => (
            <button
              type="button"
              role="radio"
              aria-checked={sample() === s.name}
              onClick={() => setSample(s.name)}
            >
              {s.label}
            </button>
          )}
        </For>
      </div>
      {/* Room around the canvas, to start a marquee or grab a handle on its edge. */}
      <div
        class="overlay-workspace"
        tabIndex={-1}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onLostPointerCapture={endDrag}
      >
        {/* Up to twice the canvas size, and no taller than half the window. */}
        <div
          ref={(e) => (stage = e)}
          class="overlay-stage"
          style={{
            'aspect-ratio': `${canvas().width} / ${canvas().height}`,
            width: `min(100%, ${canvas().width * 2}px, calc(50vh * ${canvas().width / canvas().height}))`,
          }}
        >
          <div ref={(e) => (root = e)} />
          <For each={guides()}>
            {(g) => (
              <div
                class="overlay-guide"
                classList={{ vertical: g.axis === 'x' }}
                style={
                  g.axis === 'x'
                    ? { left: percent(g.at, canvas().width) }
                    : { top: percent(g.at, canvas().height) }
                }
              />
            )}
          </For>
          <Show when={selectionBox()}>
            {(box) => (
              <div class="overlay-selection" style={boxStyle(box())}>
                <Show when={props.selection.length === 1}>
                  <For each={HANDLES}>
                    {(h) => (
                      <div
                        class="overlay-handle"
                        data-handle={h}
                        style={{
                          left: `${HANDLE_AT[h][0]}%`,
                          top: `${HANDLE_AT[h][1]}%`,
                          cursor: CURSORS[h],
                        }}
                      />
                    )}
                  </For>
                </Show>
              </div>
            )}
          </Show>
          <Show when={marquee()}>
            {(box) => <div class="overlay-marquee" style={boxStyle(box())} />}
          </Show>
        </div>
      </div>
      <p class="prop-hint">
        Drag to move, or pull a handle to resize; Shift keeps the shape. Shift-click or drag a box
        to select several. Edges snap to the canvas and each other; hold Alt not to. Arrow keys
        nudge (Shift for 10), Delete removes, Ctrl+Z undoes.
      </p>
      <Show when={nothingPlaying()}>
        <p class="empty">Nothing is playing, so the overlay is hidden, as it would be in OBS.</p>
      </Show>
    </div>
  )
}
