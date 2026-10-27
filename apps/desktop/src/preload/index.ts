import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type HaloclineBridge } from '../shared/ipc'

function listen<T>(channel: string, listener: (value: T) => void): () => void {
  const wrapped = (_: IpcRendererEvent, value: T) => listener(value)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.off(channel, wrapped)
}

const bridge: HaloclineBridge = {
  invoke: (channel, ...args) => ipcRenderer.invoke(IPC.invoke, channel, args[0]),
  onEvent: (listener) => listen(IPC.event, listener),
  player: {
    onCommand: (listener) => listen(IPC.playerCommand, listener),
    report: (report) => ipcRenderer.send(IPC.playerReport, report),
  },
}

contextBridge.exposeInMainWorld('halocline', bridge)
