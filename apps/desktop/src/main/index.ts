import { startApiServer, type RunningServer } from '@halocline/api'
import { createCore, type PlayerCommand, type PlayerReport } from '@halocline/core'
import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import { registerIpc } from './ipc'
import { handleArtworkProtocol, handleTrackProtocol, registerSchemes } from './protocol'
import { runScanInWorker } from './scan-runner'
import { createPlayerWindow, createUiWindow } from './windows'
import { lockDownYtmSession, watchYtmCookies, ytmCookie } from './ytm-auth'

registerSchemes()

// A second launch just focuses the running one (see 'second-instance').
const isPrimary = app.requestSingleInstanceLock()
if (!isPrimary) app.quit()

app.whenReady().then(async () => {
  if (!isPrimary) return
  const userData = app.getPath('userData')
  const artworkDir = join(userData, 'artwork')
  const core = createCore({
    dbPath: join(userData, 'halocline.db'),
    scanner: { artworkDir, run: runScanInWorker },
    ytm: { cookie: ytmCookie },
  })
  lockDownYtmSession()
  watchYtmCookies(() => void core.ytm.refresh())
  void core.ytm.refresh()
  handleTrackProtocol(core)
  handleArtworkProtocol(artworkDir)

  let api: RunningServer | null = null
  registerIpc(core, () => api?.url ?? null)
  try {
    api = await startApiServer(core)
    console.log(`[api] listening on ${api.url}`)
  } catch (err) {
    console.error('[api] failed to start', err)
  }

  // The player renderer owns the audio; it lives apart from the UI so a UI
  // reload never drops playback (PLAN §2).
  const player = createPlayerWindow()
  const toPlayer = (command: PlayerCommand) => {
    if (command.type === 'load' && command.engine === 'fallback') {
      // The hidden YTM window arrives in Phase 2. Report failure so the player moves on.
      core.player.report({ type: 'error', message: 'Fallback engine not built yet' })
      return
    }
    player.webContents.send(IPC.playerCommand, command)
  }
  // Connect once the page is listening (messages sent earlier are dropped), and
  // again after any reload, so it always gets the current output and fade settings.
  player.webContents.on('did-finish-load', () => core.player.connect(toPlayer))
  ipcMain.on(IPC.playerReport, (event, report: PlayerReport) => {
    if (event.sender === player.webContents) core.player.report(report)
  })

  let ui = createUiWindow()
  core.events.subscribe((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window !== player && !window.isDestroyed()) window.webContents.send(IPC.event, event)
    }
  })

  app.on('second-instance', () => {
    if (ui.isDestroyed()) ui = createUiWindow()
    ui.show()
    ui.focus()
  })
  app.on('activate', () => {
    if (ui.isDestroyed()) ui = createUiWindow()
  })
  // Closing the UI quits the app; the player window is hidden and shouldn't keep it alive.
  ui.on('closed', () => app.quit())

  void core.scanner.start()

  // Stop the scanner and API cleanly before the database closes.
  let shuttingDown = false
  app.on('will-quit', (event) => {
    if (shuttingDown) return
    shuttingDown = true
    event.preventDefault()
    void Promise.allSettled([api?.close(), core.close()]).finally(() => app.exit())
  })
})
