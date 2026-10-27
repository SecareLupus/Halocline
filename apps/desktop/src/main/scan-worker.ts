// Worker-thread entry for library scans: walks folders and reads tags off the
// main thread, posting results back for the main thread to write to SQLite.
import { runScan, type ScanInput } from '@halocline/core/scan'
import { parentPort, workerData } from 'node:worker_threads'

const port = parentPort!
const controller = new AbortController()
port.on('message', (message) => {
  if (message === 'abort') controller.abort()
})
// Let the worker exit once the scan finishes, even though the port stays open.
port.unref()

void runScan(workerData as ScanInput, (message) => port.postMessage(message), controller.signal)
