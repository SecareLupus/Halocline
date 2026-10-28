import { createSignal, onCleanup, Show } from 'solid-js'
import { call } from './bridge'
import { Artwork } from './Search'
import type { AppState } from './store'

/**
 * Transport icons as SVG: the ⏮ ⏭ glyphs come from whatever font has them, and
 * their bar and arrows don't line up. Here each bar's centre meets the arrow points.
 */
const ICONS = {
  previous: 'M5 5h2.5v14H5zM7.5 12 13.5 5v14zM13.5 12 19.5 5v14z',
  next: 'M16.5 5H19v14h-2.5zM16.5 12 10.5 5v14zM10.5 12 4.5 5v14z',
  play: 'M7 5 19 12 7 19z',
  pause: 'M6.5 5h4v14h-4zM13.5 5h4v14h-4z',
}

function Icon(props: { name: keyof typeof ICONS }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d={ICONS[props.name]} fill="currentColor" />
    </svg>
  )
}

/** Line icons: two crossing arrows (shuffle) and a loop of two arrows (repeat). */
const LINE_ICONS = {
  shuffle: 'M3 7h3.5c4 0 5 10 9 10H21M3 17h3.5c4 0 5-10 9-10H21M18 4l3 3-3 3M18 14l3 3-3 3',
  repeat:
    'M4 12V9.5A2.5 2.5 0 0 1 6.5 7H20M17 4l3 3-3 3M20 12v2.5a2.5 2.5 0 0 1-2.5 2.5H4M7 20l-3-3 3-3',
}

function LineIcon(props: { name: keyof typeof LINE_ICONS }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d={LINE_ICONS[props.name]}
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}

/** Repeat cycles off → all (the queue goes round) → one (this song) → off. */
const NEXT_REPEAT = { off: 'all', all: 'one', one: 'off' } as const
const REPEAT_LABEL = {
  off: 'Repeat is off',
  all: 'Repeat: played songs go back on the end of the queue',
  one: 'Repeat this song',
} as const

const formatTime = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function NowPlaying(props: { state: AppState }) {
  // Extrapolate position between events, as the overlay will (PLAN §8).
  const [now, setNow] = createSignal(Date.now())
  const timer = setInterval(() => setNow(Date.now()), 250)
  onCleanup(() => clearInterval(timer))

  const p = () => props.state.player()
  const position = () => {
    const s = p()
    if (!s) return 0
    return s.playing ? s.positionMs + (now() - s.positionAt) : s.positionMs
  }
  const duration = () => p()?.current?.recording.durationMs ?? null
  const control = (fn: () => Promise<unknown>) => void props.state.run(fn)
  /** Clicking the bar (or letting go after dragging along it) seeks there. */
  const seek = (e: PointerEvent & { currentTarget: HTMLElement }) => {
    const length = duration()
    if (!length || !p()?.current) return
    const box = e.currentTarget.getBoundingClientRect()
    const at = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width))
    control(() => call('player.patch', { positionMs: Math.round(at * length) }))
  }

  return (
    <section class="now-playing">
      <div class="transport">
        <button
          type="button"
          aria-label="Shuffle"
          aria-pressed={p()?.shuffle ?? false}
          classList={{ on: p()?.shuffle ?? false }}
          title={p()?.shuffle ? 'Shuffle is on: next is a random queued song' : 'Shuffle is off'}
          onClick={() => control(() => call('player.patch', { shuffle: !p()?.shuffle }))}
        >
          <LineIcon name="shuffle" />
        </button>
        <button
          type="button"
          aria-label="Previous"
          onClick={() => control(() => call('player.previous'))}
        >
          <Icon name="previous" />
        </button>
        <button
          type="button"
          aria-label={p()?.playing ? 'Pause' : 'Play'}
          onClick={() => control(() => call('player.patch', { playing: !p()?.playing }))}
        >
          <Icon name={p()?.playing ? 'pause' : 'play'} />
        </button>
        <button type="button" aria-label="Next" onClick={() => control(() => call('player.next'))}>
          <Icon name="next" />
        </button>
        <button
          type="button"
          class="repeat"
          aria-label={REPEAT_LABEL[p()?.repeat ?? 'off']}
          title={REPEAT_LABEL[p()?.repeat ?? 'off']}
          classList={{ on: (p()?.repeat ?? 'off') !== 'off' }}
          onClick={() =>
            control(() => call('player.patch', { repeat: NEXT_REPEAT[p()?.repeat ?? 'off'] }))
          }
        >
          <LineIcon name="repeat" />
          <Show when={p()?.repeat === 'one'}>
            <span class="repeat-one">1</span>
          </Show>
        </button>
      </div>
      <Show
        when={p()?.current}
        fallback={<span class="art" style={{ width: '48px', height: '48px' }} />}
      >
        {(c) => <Artwork track={c().recording} size={48} />}
      </Show>
      <div class="current">
        <Show when={p()?.current} fallback={<span class="empty">Nothing playing</span>}>
          {(c) => (
            <>
              <span class="title">{c().recording.title}</span>
              <span class="artist">
                {c().recording.artists.join(', ') || 'Unknown artist'}
                <span class={`badge engine-${c().engine}`}>{c().engine}</span>
              </span>
            </>
          )}
        </Show>
        <div class="progress">
          <span>{formatTime(position())}</span>
          <div
            class="bar"
            classList={{ seekable: Boolean(duration() && p()?.current) }}
            role="slider"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={duration() ?? 0}
            aria-valuenow={Math.round(position())}
            // Captured, so releasing past either end of the bar still seeks.
            onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
            onPointerUp={(e) => seek(e)}
          >
            <div
              class="fill"
              style={{
                width: duration() ? `${Math.min(100, (position() / duration()!) * 100)}%` : '0%',
              }}
            />
          </div>
          <span>{duration() ? formatTime(duration()!) : '–:––'}</span>
        </div>
      </div>
      <input
        class="volume"
        type="range"
        min="0"
        max="1"
        step="0.01"
        aria-label="Volume"
        value={p()?.volume ?? 0.8}
        onInput={(e) =>
          control(() => call('player.patch', { volume: Number(e.currentTarget.value) }))
        }
      />
    </section>
  )
}
