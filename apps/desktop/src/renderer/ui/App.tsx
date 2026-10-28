import { createSignal, Show } from 'solid-js'
import { History } from './History'
import { NowPlaying } from './NowPlaying'
import { QueueList } from './QueueList'
import { Search } from './Search'
import { SettingsPanel } from './SettingsPanel'
import { createAppState } from './store'

export function App() {
  const state = createAppState()
  const [showSettings, setShowSettings] = createSignal(false)
  /** The left pane: search, or the play history. The queue stays on the right. */
  const [showHistory, setShowHistory] = createSignal(false)

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
    <div class="app">
      <header class="topbar">
        <h1>Halocline</h1>
        <nav class="topbar-actions">
          <button
            type="button"
            aria-pressed={showHistory() && !showSettings()}
            onClick={() => {
              setShowSettings(false)
              setShowHistory((v) => !v)
            }}
          >
            {showHistory() && !showSettings() ? 'Search' : 'History'}
          </button>
          <button type="button" onClick={() => setShowSettings((v) => !v)}>
            {showSettings() ? 'Close settings' : 'Settings'}
          </button>
        </nav>
      </header>
      <main class="panes">
        <Show when={!showSettings()} fallback={<SettingsPanel state={state} />}>
          {/* Search stays mounted under History, so its query and results survive. */}
          <div class="pane-slot" classList={{ hidden: showHistory() }}>
            <Search state={state} />
          </div>
          <Show when={showHistory()}>
            <History state={state} />
          </Show>
          <QueueList state={state} />
        </Show>
      </main>
      <NowPlaying state={state} />
      <footer class="statusbar">
        <span class={`dot dot-${state.health()?.status ?? 'green'}`} title={healthLabel()} />
        <span>{state.error() ?? healthLabel()}</span>
        <Show when={scanLabel()}>
          <span class="badge">{scanLabel()}</span>
        </Show>
        <Show when={state.settings()?.streamSafeMode}>
          <span class="badge">Stream-safe</span>
        </Show>
      </footer>
    </div>
  )
}
