import { startApiServer, type RunningServer } from '@halocline/api'
import { createCore, type PlayerReport } from '@halocline/core'
import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import { registerIpc } from './ipc'
import { handleTrackProtocol, registerTrackScheme } from './protocol'
import { createPlayerWindow, createUiWindow } from './windows'

registerTrackScheme()

if (!app.requestSingleInstanceLock()) app.quit()

app.whenReady().then(async () => {
  const core = createCore({ dbPath: join(app.getPath('userData'), 'halocline.db') })
  handleTrackProtocol(core)

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
  core.player.connect((command) => {
    if (command.type === 'load' && command.engine === 'fallback') {
      // The hidden YTM window arrives in Phase 2. Report failure so the player moves on.
      core.player.report({ type: 'error', message: 'Fallback engine not built yet' })
      return
    }
    player.webContents.send(IPC.playerCommand, command)
  })
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

  app.on('will-quit', () => {
    void api?.close()
    core.close()
  })
})
