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
