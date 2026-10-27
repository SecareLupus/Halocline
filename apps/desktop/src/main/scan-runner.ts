import type { ScanRunner } from '@halocline/core'
import createScanWorker from './scan-worker?nodeWorker'

/** Runs each scan job in its own worker thread, so tag parsing never blocks the main process. */
export const runScanInWorker: ScanRunner = (input, onMessage, signal) =>
  new Promise((resolve, reject) => {
    const worker = createScanWorker({ workerData: input })
    const abort = () => worker.postMessage('abort')
    signal.addEventListener('abort', abort, { once: true })
    worker.on('message', onMessage)
    worker.on('error', reject)
    worker.on('exit', (code) => {
      signal.removeEventListener('abort', abort)
      if (code === 0 || signal.aborted) resolve()
      else reject(new Error(`Scan worker exited with code ${code}`))
    })
  })
