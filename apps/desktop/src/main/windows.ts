import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import icon from '../../build/icon.png?asset'

const preload = join(import.meta.dirname, '../preload/index.cjs')

function load(window: BrowserWindow, page: 'ui' | 'player' | 'analysis'): void {
  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (devServer) void window.loadURL(`${devServer}/${page}/index.html`)
  else void window.loadFile(join(import.meta.dirname, `../renderer/${page}/index.html`))
}

export function createUiWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 420,
    minHeight: 480,
    title: 'Halocline',
    // Installers carry the icon themselves; this shows it on Linux taskbars and in dev.
    icon,
    show: false,
    autoHideMenuBar: true,
    webPreferences: { preload, sandbox: true, contextIsolation: true },
  })
  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  load(window, 'ui')
  return window
}

/** Hidden window that holds the two-deck audio graph. */
export function createPlayerWindow(): BrowserWindow {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload,
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  })
  load(window, 'player')
  return window
}

/** Hidden window that analyzes audio for autoplay (PLAN §7), created when there's work. */
export function createAnalysisWindow(): BrowserWindow {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { preload, sandbox: true, contextIsolation: true, backgroundThrottling: false },
  })
  load(window, 'analysis')
  return window
}
