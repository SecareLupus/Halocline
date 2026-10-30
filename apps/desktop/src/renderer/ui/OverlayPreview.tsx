import type { PlayerState } from '@halocline/core'
import type { OverlayDocument } from '@halocline/core/overlay'
import {
  mountOverlay,
  SAMPLES,
  sampleState,
  type OverlayView,
  type SampleName,
} from '@halocline/overlay'
import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js'

type Sample = SampleName | 'live'

/** Sample art is a data URI; local cover art is served over artwork://; cloud art is a URL. */
const previewArtwork = (artwork: string) =>
  artwork.startsWith('https://') || artwork.startsWith('data:') ? artwork : `artwork://${artwork}`

/**
 * The overlay drawn by the same renderer OBS uses (PLAN §8), with a sample song
 * or what's playing. Clicking an element selects it; the selection is outlined.
 */
export function OverlayPreview(props: {
  doc: OverlayDocument
  player: PlayerState | null
  selected: string | null
  onSelect: (id: string | null) => void
}) {
  const [sample, setSample] = createSignal<Sample>('playing')
  const stateFor = (s: Sample) => (s === 'live' ? props.player : sampleState(s))
  let root: HTMLDivElement | undefined
  let view: OverlayView | undefined

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
  const box = () => props.doc.elements.find((e) => e.id === props.selected)
  const percent = (n: number, of: number) => `${(n / of) * 100}%`
  const nothingPlaying = () => sample() === 'live' && (!props.player?.current || props.player.ad)

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
      {/* Up to twice the canvas size, and no taller than half the window. */}
      <div
        class="overlay-stage"
        style={{
          'aspect-ratio': `${canvas().width} / ${canvas().height}`,
          width: `min(100%, ${canvas().width * 2}px, calc(50vh * ${canvas().width / canvas().height}))`,
        }}
        onClick={(e) => {
          const element = (e.target as Element).closest<HTMLElement>('[data-id]')
          props.onSelect(element?.dataset.id ?? null)
        }}
      >
        <div ref={(e) => (root = e)} />
        <Show when={box()}>
          {(b) => (
            <div
              class="overlay-selection"
              style={{
                left: percent(b().x, canvas().width),
                top: percent(b().y, canvas().height),
                width: percent(b().width, canvas().width),
                height: percent(b().height, canvas().height),
              }}
            />
          )}
        </Show>
      </div>
      <Show when={nothingPlaying()}>
        <p class="empty">Nothing is playing, so the overlay is hidden, as it would be in OBS.</p>
      </Show>
    </div>
  )
}
