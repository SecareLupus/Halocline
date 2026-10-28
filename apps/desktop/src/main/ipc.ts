import {
  BulkRecordingPatch,
  DomainError,
  Id,
  MergeRecordings,
  PlayerPatch,
  QueuePosition,
  RecordingPatch,
  Scope,
  SettingsPatch,
  SplitRecording,
  YtmSong,
  type Core,
} from '@halocline/core'
import { OVERLAY_SIZE, overlayUrl } from '@halocline/api'
import { BrowserWindow, clipboard, dialog, ipcMain } from 'electron'
import { z } from 'zod'
import {
  IPC,
  type IpcChannel,
  type IpcHandlers,
  type IpcResult,
  type OverlayInfo,
} from '../shared/ipc'
import { openYtmSignIn, signOutYtm } from './ytm-auth'

type Handler<C extends IpcChannel> = (
  args: unknown,
) => ReturnType<IpcHandlers[C]> | Promise<ReturnType<IpcHandlers[C]>>

/** Wires UI requests to the same core services the HTTP API uses. */
export function registerIpc(core: Core, apiUrl: () => string | null): void {
  const copyOverlay = (secret: string): OverlayInfo => {
    const base = apiUrl()
    if (!base) throw new DomainError('provider_unavailable', 'The API server is not running')
    const url = overlayUrl(base, secret)
    clipboard.writeText(url)
    return { url, ...OVERLAY_SIZE }
  }
  const handlers: { [C in IpcChannel]: Handler<C> } = {
    'library.search': (a) => core.library.search(z.object({ q: z.string() }).parse(a).q),
    search: (a) => core.catalog.search(z.object({ q: z.string().min(1).max(200) }).parse(a).q),
    resolve: (a) =>
      core.catalog.preview(z.object({ input: z.string().min(1).max(2000) }).parse(a).input),
    'queue.addInput': async (a) => {
      const { input, position } = z
        .object({ input: z.string().min(1).max(2000), position: QueuePosition.optional() })
        .parse(a)
      const recording = await core.catalog.resolve(input)
      return core.queue.add({
        recordingId: recording.id,
        origin: 'user',
        ...(position && { position }),
      })
    },
    'collection.get': (a) =>
      core.catalog.collection(z.object({ ref: z.string().min(1).max(200) }).parse(a).ref),
    'collection.match': (a) =>
      core.catalog.matchCollection(z.object({ input: z.string().min(1).max(2000) }).parse(a).input),
    'queue.addCollection': (a) => {
      const { ref, position } = z
        .object({ ref: z.string().min(1).max(2000), position: QueuePosition.optional() })
        .parse(a)
      return core.catalog.enqueueCollection(ref, { origin: 'user', ...(position && { position }) })
    },
    'queue.addYtm': (a) => {
      const { song, position } = z
        .object({ song: YtmSong, position: QueuePosition.optional() })
        .parse(a)
      const recording = core.catalog.addYtmSong(song)
      return core.queue.add({
        recordingId: recording.id,
        origin: 'user',
        ...(position && { position }),
      })
    },
    'ytm.status': () => core.ytm.status(),
    'ytm.accounts': () => core.ytm.accounts(),
    'ytm.selectAccount': (a) =>
      core.ytm.selectAccount(z.object({ id: z.string().min(1).nullable() }).parse(a).id),
    'ytm.signIn': () => {
      openYtmSignIn(BrowserWindow.getFocusedWindow() ?? undefined)
    },
    'ytm.signOut': async () => {
      await signOutYtm()
      await core.ytm.refresh()
    },
    'library.edit': (a) => {
      const { id, changes } = z.object({ id: Id, changes: RecordingPatch }).parse(a)
      return core.library.edit(id, changes)
    },
    'library.editMany': (a) => {
      const { ids, changes } = BulkRecordingPatch.parse(a)
      return core.library.editMany(ids, changes)
    },
    'history.list': (a) => {
      const { before } = z.object({ before: z.string().max(40).optional() }).parse(a ?? {})
      return core.library.history({ limit: 50, ...(before && { before }) })
    },
    'history.clear': () => core.library.clearHistory(),
    'library.merge': (a) => {
      const { id, from } = z.object({ id: Id }).extend(MergeRecordings.shape).parse(a)
      return core.catalog.merge(id, from)
    },
    'library.split': (a) => {
      const { id, sourceIds } = z.object({ id: Id }).extend(SplitRecording.shape).parse(a)
      return core.catalog.split(id, sourceIds)
    },
    'library.addFolder': async () => {
      const window = BrowserWindow.getFocusedWindow()
      const options: Electron.OpenDialogOptions = {
        title: 'Add a music folder',
        properties: ['openDirectory'],
      }
      const { filePaths } = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options)
      const folders = core.settings.get().library.folders
      const added = filePaths.filter((f) => !folders.includes(f))
      return added.length
        ? core.settings.patch({ library: { folders: [...folders, ...added] } })
        : core.settings.get()
    },
    'library.removeFolder': (a) => {
      const { folder } = z.object({ folder: z.string() }).parse(a)
      const folders = core.settings.get().library.folders.filter((f) => f !== folder)
      return core.settings.patch({ library: { folders } })
    },
    'library.rescan': (a) => {
      const { full } = z.object({ full: z.boolean().optional() }).parse(a ?? {})
      void core.scanner.scan({ full: full ?? false })
    },
    'scan.status': () => core.scanner.status(),
    'analysis.status': () => core.analysis.status(),
    'queue.list': () => core.queue.list(),
    'queue.add': (a) => {
      const { recordingId, position } = z
        .object({ recordingId: Id, position: QueuePosition.optional() })
        .parse(a)
      return core.queue.add({ recordingId, origin: 'user', ...(position && { position }) })
    },
    'queue.move': (a) => {
      const { id, position } = z.object({ id: Id, position: QueuePosition }).parse(a)
      return core.queue.move(id, position)
    },
    'queue.remove': (a) => core.queue.remove(z.object({ id: Id }).parse(a).id),
    'queue.pin': (a) => {
      const { id, sourceId } = z.object({ id: Id, sourceId: Id.nullable() }).parse(a)
      return core.queue.pinSource(id, sourceId)
    },
    'library.saveYtm': (a) => core.catalog.saveYtmSong(z.object({ song: YtmSong }).parse(a).song),
    'player.get': () => core.player.get(),
    'player.output': () => core.player.getOutput(),
    'player.patch': (a) => core.player.patch(PlayerPatch.parse(a)),
    'player.next': () => core.player.next(),
    'player.previous': () => core.player.previous(),
    'health.get': () => core.health.get(),
    'settings.get': () => core.settings.get(),
    'settings.patch': (a) => core.settings.patch(SettingsPatch.parse(a)),
    'tokens.list': () => core.tokens.list(),
    'tokens.create': (a) => {
      const { name, scopes, rateLimitPerMin } = z
        .object({
          name: z.string().min(1).max(100),
          scopes: z.array(Scope).min(1),
          rateLimitPerMin: z.number().int().positive().max(100_000).optional(),
        })
        .parse(a)
      return core.tokens.create(name, scopes, rateLimitPerMin)
    },
    'tokens.revoke': (a) => core.tokens.revoke(z.object({ id: Id }).parse(a).id),
    'api.url': () => apiUrl(),
    'overlay.copy': () => copyOverlay(core.tokens.overlaySecret()),
    'overlay.rotate': () => copyOverlay(core.tokens.rotateOverlay()),
  }

  ipcMain.handle(
    IPC.invoke,
    async (_event, channel: string, args: unknown): Promise<IpcResult<unknown>> => {
      const handler = handlers[channel as IpcChannel] as Handler<IpcChannel> | undefined
      if (!handler)
        return { ok: false, error: { type: 'not_found', message: `Unknown channel ${channel}` } }
      try {
        return { ok: true, value: await handler(args) }
      } catch (err) {
        if (err instanceof DomainError)
          return { ok: false, error: { type: err.type, message: err.message } }
        if (err instanceof z.ZodError)
          return { ok: false, error: { type: 'invalid_request', message: err.message } }
        console.error(`[ipc] ${channel}`, err)
        return { ok: false, error: { type: 'internal', message: String(err) } }
      }
    },
  )
}
