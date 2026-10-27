import type {
  Health,
  OutputState,
  PlayerState,
  Queue,
  ScanStatus,
  Settings,
  YtmStatus,
} from '@halocline/core'
import { createSignal, onCleanup } from 'solid-js'
import { call } from './bridge'

/** Live app state, kept current from the main process's event stream. */
export function createAppState() {
  const [player, setPlayer] = createSignal<PlayerState | null>(null)
  const [queue, setQueue] = createSignal<Queue>({ revision: 0, items: [] })
  const [health, setHealth] = createSignal<Health | null>(null)
  const [settings, setSettings] = createSignal<Settings | null>(null)
  const [scan, setScan] = createSignal<ScanStatus | null>(null)
  const [output, setOutput] = createSignal<OutputState | null>(null)
  const [ytm, setYtm] = createSignal<YtmStatus | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  /** Bumped when the library changes, so views can re-run their queries. */
  const [libraryVersion, setLibraryVersion] = createSignal(0)

  const refreshQueue = () => call('queue.list').then(setQueue)
  void call('player.get').then(setPlayer)
  void call('health.get').then(setHealth)
  void call('settings.get').then(setSettings)
  void call('scan.status').then(setScan)
  void call('player.output').then(setOutput)
  void call('ytm.status').then(setYtm)
  void refreshQueue()

  const off = window.halocline.onEvent((event) => {
    switch (event.type) {
      case 'player.changed':
      case 'track.changed':
        return setPlayer(event.data)
      case 'queue.changed':
        return void refreshQueue()
      case 'health.changed':
        return setHealth(event.data)
      case 'settings.changed':
        return setSettings(event.data)
      case 'scan.changed':
        return setScan(event.data)
      case 'output.changed':
        return setOutput(event.data)
      case 'ytm.changed':
        return setYtm(event.data)
      case 'library.changed':
        return setLibraryVersion((v) => v + 1)
    }
  })
  onCleanup(off)

  /** Runs an action and shows its error, if any, in the status bar. */
  const run = async (action: () => Promise<unknown>) => {
    try {
      setError(null)
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return { player, queue, health, settings, scan, output, ytm, libraryVersion, error, run }
}

export type AppState = ReturnType<typeof createAppState>
