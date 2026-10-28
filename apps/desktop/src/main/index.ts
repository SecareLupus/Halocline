import { startApiServer, type RunningServer } from '@halocline/api'
import { createCore, EngineRouter, type PlayerReport } from '@halocline/core'
import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import { AnalysisHost } from './analysis'
import { registerIpc } from './ipc'
import { handleArtworkProtocol, handleTrackProtocol, registerSchemes } from './protocol'
import { runScanInWorker } from './scan-runner'
import { runStreamSelfTest } from './stream-self-test'
import { createPlayerWindow, createUiWindow } from './windows'
import { lockDownYtmSession, switchYtmChannel, watchYtmCookies, ytmCookie } from './ytm-auth'
import { YtmFallbackEngine } from './ytm-engine'
import { YtmPageRuntime } from './ytm-runtime'

registerSchemes()

// `--test-stream` runs the direct-engine canary and exits (PLAN §4).
const selfTest = process.argv.includes('--test-stream')

// A second launch just focuses the running one (see 'second-instance').
const isPrimary = selfTest || app.requestSingleInstanceLock()
if (!isPrimary) app.quit()

app.whenReady().then(async () => {
  if (selfTest) {
    app.exit(await runStreamSelfTest())
    return
  }
  if (!isPrimary) return
  const userData = app.getPath('userData')
  const artworkDir = join(userData, 'artwork')
  const pageRuntime = new YtmPageRuntime()
  const core = createCore({
    dbPath: join(userData, 'halocline.db'),
    scanner: { artworkDir, run: runScanInWorker },
    ytm: { cookie: ytmCookie },
    stream: {
      runtime: pageRuntime,
      cacheDir: join(userData, 'track-cache'),
      playerCacheDir: join(userData, 'player-cache'),
    },
  })
  watchYtmCookies(() => {
    void core.ytm.refresh()
    core.streamer?.refresh()
  })
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
  // reload never drops playback (PLAN §2). Fallback tracks play in the hidden
  // YouTube Music window instead; the router sends each command to the right one.
  const player = createPlayerWindow()
  const router = new EngineRouter({
    player: (command) => player.webContents.send(IPC.playerCommand, command),
    fallback: (command) => fallback.send(command),
  })
  const fallback = new YtmFallbackEngine(
    (sourceId) => {
      const source = core.library.source(sourceId)
      return source?.kind === 'ytm' ? source.locator : undefined
    },
    (report) => {
      if (router.accepts('fallback', report)) core.player.report(report)
    },
  )
  lockDownYtmSession((contents) => fallback.owns(contents))
  // Connect once the page is listening (messages sent earlier are dropped), and
  // again after any reload, so it always gets the current output and fade settings.
  player.webContents.on('did-finish-load', () => core.player.connect((c) => router.send(c)))
  ipcMain.on(IPC.playerReport, (event, report: PlayerReport) => {
    if (event.sender === player.webContents && router.accepts('player', report)) {
      core.player.report(report)
    }
  })
  // The fallback's web pages play as the chosen channel too (search and the direct
  // engine get it from the core).
  let channel = core.ytm.status().accountId
  core.events.subscribe((event) => {
    if (event.type !== 'ytm.changed' || event.data.accountId === channel) return
    channel = event.data.accountId
    void core.ytm
      .accounts()
      .then((accounts) => {
        const chosen =
          accounts.find((a) => a.id === channel) ?? accounts.find((a) => !a.id.includes(':'))
        return chosen?.switchUrl ? switchYtmChannel(chosen.switchUrl) : undefined
      })
      .catch((err: unknown) => console.error('[ytm] switching channels', err))
  })
  // The fallback plays on the same device as the player renderer.
  core.events.subscribe((event) => {
    if (event.type !== 'output.changed') return
    const { devices, activeDeviceId } = event.data
    fallback.setOutput(devices.find((d) => d.deviceId === activeDeviceId)?.label ?? null)
  })

  // Audio analysis for autoplay (PLAN §7) runs in its own hidden window, opened when needed.
  const analysis = new AnalysisHost(core, join(userData, 'models'))
  void analysis.start()

  let ui = createUiWindow()
  core.events.subscribe((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window === player || analysis.owns(window) || window.isDestroyed()) continue
      window.webContents.send(IPC.event, event)
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
    pageRuntime.destroy()
    fallback.destroy()
    analysis.destroy()
    void Promise.allSettled([api?.close(), core.close()]).finally(() => app.exit())
  })
})
