import type { Health, PlayerState, Queue, Settings } from '@halocline/core'
import { createSignal, onCleanup } from 'solid-js'
import { call } from './bridge'

/** Live app state, kept current from the main process's event stream. */
export function createAppState() {
  const [player, setPlayer] = createSignal<PlayerState | null>(null)
  const [queue, setQueue] = createSignal<Queue>({ revision: 0, items: [] })
  const [health, setHealth] = createSignal<Health | null>(null)
  const [settings, setSettings] = createSignal<Settings | null>(null)
  const [error, setError] = createSignal<string | null>(null)

  const refreshQueue = () => call('queue.list').then(setQueue)
  void call('player.get').then(setPlayer)
  void call('health.get').then(setHealth)
  void call('settings.get').then(setSettings)
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

  return { player, queue, health, settings, error, run }
}

export type AppState = ReturnType<typeof createAppState>
