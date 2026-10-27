import { createSignal, Show } from 'solid-js'
import { NowPlaying } from './NowPlaying'
import { QueueList } from './QueueList'
import { Search } from './Search'
import { SettingsPanel } from './SettingsPanel'
import { createAppState } from './store'

export function App() {
  const state = createAppState()
  const [showSettings, setShowSettings] = createSignal(false)

  const healthLabel = () => {
    const h = state.health()
    if (!h) return ''
    if (h.status === 'red') return 'Direct streaming is failing; check for an update'
    if (h.status === 'amber') return 'The fallback engine was used recently'
    return 'Direct streaming is working'
  }

  return (
    <div class="app">
      <header class="topbar">
        <h1>Halocline</h1>
        <button type="button" onClick={() => setShowSettings((v) => !v)}>
          {showSettings() ? 'Close settings' : 'Settings'}
        </button>
      </header>
      <main class="panes">
        <Show when={!showSettings()} fallback={<SettingsPanel state={state} />}>
          <Search state={state} />
          <QueueList state={state} />
        </Show>
      </main>
      <NowPlaying state={state} />
      <footer class="statusbar">
        <span class={`dot dot-${state.health()?.status ?? 'green'}`} title={healthLabel()} />
        <span>{state.error() ?? healthLabel()}</span>
        <Show when={state.settings()?.streamSafeMode}>
          <span class="badge">Stream-safe</span>
        </Show>
      </footer>
    </div>
  )
}
