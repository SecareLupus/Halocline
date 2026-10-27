import type { IpcChannel, IpcHandlers } from '../../shared/ipc'

export class BridgeError extends Error {
  constructor(
    readonly type: string,
    message: string,
  ) {
    super(message)
  }
}

/** Calls the main process and unwraps the result, throwing on domain errors. */
export async function call<C extends IpcChannel>(
  channel: C,
  ...args: Parameters<IpcHandlers[C]>
): Promise<ReturnType<IpcHandlers[C]>> {
  const result = await window.halocline.invoke(channel, ...args)
  if (!result.ok) throw new BridgeError(result.error.type, result.error.message)
  return result.value
}
