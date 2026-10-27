import type { HaloclineBridge } from '../shared/ipc'

declare global {
  interface Window {
    halocline: HaloclineBridge
  }
}
