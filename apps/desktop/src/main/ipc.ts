import {
  DomainError,
  Id,
  PlayerPatch,
  QueuePosition,
  Scope,
  SettingsPatch,
  type Core,
} from '@halocline/core'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { basename, extname } from 'node:path'
import { z } from 'zod'
import { IPC, type IpcChannel, type IpcHandlers, type IpcResult } from '../shared/ipc'

type Handler<C extends IpcChannel> = (
  args: unknown,
) => ReturnType<IpcHandlers[C]> | Promise<ReturnType<IpcHandlers[C]>>

const AUDIO_EXTENSIONS = ['mp3', 'flac', 'ogg', 'opus', 'm4a', 'aac', 'wav']

/** Wires UI requests to the same core services the HTTP API uses. */
export function registerIpc(core: Core, apiUrl: () => string | null): void {
  const handlers: { [C in IpcChannel]: Handler<C> } = {
    'library.search': (a) => core.library.search(z.object({ q: z.string() }).parse(a).q),
    // Stand-in until the scanner lands: one recording per file, titled by filename.
    'library.addFiles': async () => {
      const window = BrowserWindow.getFocusedWindow()
      const options: Electron.OpenDialogOptions = {
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Audio', extensions: AUDIO_EXTENSIONS }],
      }
      const { filePaths } = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options)
      return filePaths.map((path) => {
        const recording = core.library.create({
          title: basename(path, extname(path)),
          artists: [],
          inLibrary: true,
        })
        core.library.addSource(recording.id, { kind: 'local', locator: path })
        return recording
      })
    },
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
    'player.get': () => core.player.get(),
    'player.patch': (a) => core.player.patch(PlayerPatch.parse(a)),
    'player.next': () => core.player.next(),
    'player.previous': () => core.player.previous(),
    'health.get': () => core.health.get(),
    'settings.get': () => core.settings.get(),
    'settings.patch': (a) => core.settings.patch(SettingsPatch.parse(a)),
    'tokens.list': () => core.tokens.list(),
    'tokens.create': (a) => {
      const { name, scopes } = z
        .object({ name: z.string().min(1).max(100), scopes: z.array(Scope).min(1) })
        .parse(a)
      return core.tokens.create(name, scopes)
    },
    'tokens.revoke': (a) => core.tokens.revoke(z.object({ id: Id }).parse(a).id),
    'api.url': () => apiUrl(),
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
