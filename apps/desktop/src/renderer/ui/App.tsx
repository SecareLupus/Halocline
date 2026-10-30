import { createSignal, Match, onCleanup, Show, Switch } from 'solid-js'
import { ContextMenuHost } from './ContextMenu'
import { History } from './History'
import { NowPlaying } from './NowPlaying'
import { OverlayEditor } from './OverlayEditor'
import { PlayerView } from './PlayerView'
import { QueueList } from './QueueList'
import { Search } from './Search'
import { SettingsPanel } from './SettingsPanel'
import { createSplit, Splitter } from './Splitter'
import { createAppState } from './store'

/** Narrower than this, search and the queue stack, and the player bar gets compact. */
const STACKED = '(max-width: 719px)'

type View = 'main' | 'history' | 'overlays' | 'settings' | 'player'

export function App() {
  const state = createAppState()
  /** Search beside (or over) the queue, or one full-window view in its place. */
  const [view, setView] = createSignal<View>('main')
  const toggle = (v: View) => setView((current) => (current === v ? 'main' : v))

  const narrow = matchMedia(STACKED)
  const [stacked, setStacked] = createSignal(narrow.matches)
  const onNarrow = (e: MediaQueryListEvent) => setStacked(e.matches)
  narrow.addEventListener('change', onNarrow)
  onCleanup(() => narrow.removeEventListener('change', onNarrow))
  const [columns, setColumns] = createSplit('halocline.split.columns')
  const [rows, setRows] = createSplit('halocline.split.rows')
  const split = () => (stacked() ? rows() : columns())

  const healthLabel = () => {
    const h = state.health()
    if (!h) return ''
    if (h.status === 'red') return 'Direct streaming is failing; check for an update'
    if (h.status === 'amber') return 'The fallback engine was used recently'
    if (!state.ytm()?.playback) return 'Local playback only: no YouTube Music engine yet'
    return 'Direct streaming is working'
  }

  const scanLabel = () => {
    const s = state.scan()
    if (s?.state !== 'scanning') return null
    return s.phase === 'reading'
      ? `Reading tags… ${s.processed} files`
      : `Scanning library… ${s.found} files found`
  }

  return (
    <div class="app" classList={{ stacked: stacked(), 'player-open': view() === 'player' }}>
      <Show when={view() !== 'player'}>
        <header class="topbar">
          <h1>Halocline</h1>
          <nav class="topbar-actions">
            <button
              type="button"
              aria-pressed={view() === 'history'}
              onClick={() => toggle('history')}
            >
              {view() === 'history' ? 'Close history' : 'History'}
            </button>
            <button
              type="button"
              aria-pressed={view() === 'overlays'}
              onClick={() => toggle('overlays')}
            >
              {view() === 'overlays' ? 'Close overlays' : 'Overlays'}
            </button>
            <button
              type="button"
              aria-pressed={view() === 'settings'}
              onClick={() => toggle('settings')}
            >
              {view() === 'settings' ? 'Close settings' : 'Settings'}
            </button>
          </nav>
        </header>
      </Show>
      {/* Search stays mounted under the other views, so its query and results survive. */}
      <main
        class="panes"
        classList={{ hidden: view() !== 'main' }}
        // As fr, so the panes share what the splitter leaves.
        style={{ '--first': `${split()}fr`, '--second': `${1 - split()}fr` }}
      >
        <Search state={state} />
        <Splitter
          vertical={stacked()}
          ratio={split()}
          onChange={(r) => (stacked() ? setRows(r) : setColumns(r))}
        />
        <QueueList state={state} />
      </main>
      <Switch>
        <Match when={view() === 'history'}>
          <main class="view">
            <History state={state} />
          </main>
        </Match>
        <Match when={view() === 'overlays'}>
          <main class="view">
            <OverlayEditor state={state} />
          </main>
        </Match>
        <Match when={view() === 'settings'}>
          <main class="view">
            <SettingsPanel state={state} />
          </main>
        </Match>
        <Match when={view() === 'player'}>
          <main class="view">
            <PlayerView state={state} onClose={() => setView('main')} />
          </main>
        </Match>
      </Switch>
      <Show when={view() !== 'player'}>
        <NowPlaying state={state} compact={stacked()} onExpand={() => setView('player')} />
      </Show>
      <footer class="statusbar">
        <span class={`dot dot-${state.health()?.status ?? 'green'}`} title={healthLabel()} />
        <span class="status-text">{state.error() ?? healthLabel()}</span>
        <Show when={scanLabel()}>
          <span class="badge">{scanLabel()}</span>
        </Show>
        <Show when={state.settings()?.streamSafeMode}>
          <span class="badge">Stream-safe</span>
        </Show>
      </footer>
      <ContextMenuHost />
    </div>
  )
}
