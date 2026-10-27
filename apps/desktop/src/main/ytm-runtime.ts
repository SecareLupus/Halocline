import type { PageRuntime } from '@halocline/core'
import { BrowserWindow } from 'electron'
import { YTM_PARTITION } from './ytm-auth'

/** A tiny same-origin document, so scripts run on www.youtube.com as in the web player. */
const PAGE_URL = 'https://www.youtube.com/robots.txt'

/**
 * Where Google's scripts for the direct engine run (BotGuard and the player's
 * URL decipher): a hidden, sandboxed window on the YTM session with no preload
 * and no Node, created on first use and recreated if its renderer dies.
 */
export class YtmPageRuntime implements PageRuntime {
  private window: BrowserWindow | null = null
  private loaded: Promise<void> | null = null

  async run(code: string): Promise<unknown> {
    const window = await this.page()
    return window.webContents.executeJavaScript(code)
  }

  destroy(): void {
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = null
    this.loaded = null
  }

  private async page(): Promise<BrowserWindow> {
    if (!this.window || this.window.isDestroyed()) {
      const window = new BrowserWindow({
        show: false,
        webPreferences: {
          partition: YTM_PARTITION,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          // BotGuard keeps timers; a hidden window would otherwise be throttled.
          backgroundThrottling: false,
        },
      })
      window.webContents.setAudioMuted(true)
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', (event) => event.preventDefault())
      window.webContents.on('render-process-gone', () => this.destroy())
      this.window = window
      this.loaded = window.loadURL(PAGE_URL).catch((err: unknown) => {
        this.destroy()
        throw err
      })
    }
    const window = this.window
    await this.loaded
    return window
  }
}
