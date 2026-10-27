import { createSignal, onCleanup, Show } from 'solid-js'
import { call } from './bridge'
import { Artwork } from './Search'
import type { AppState } from './store'

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

  return (
    <section class="now-playing">
      <div class="transport">
        <button
          type="button"
          aria-label="Previous"
          onClick={() => control(() => call('player.previous'))}
        >
          ⏮
        </button>
        <button
          type="button"
          aria-label={p()?.playing ? 'Pause' : 'Play'}
          onClick={() => control(() => call('player.patch', { playing: !p()?.playing }))}
        >
          {p()?.playing ? '⏸' : '▶'}
        </button>
        <button type="button" aria-label="Next" onClick={() => control(() => call('player.next'))}>
          ⏭
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
          <div class="bar">
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
