import { subscribe } from '@parcel/watcher'
import { extname } from 'node:path'
import { AUDIO_EXTENSIONS } from './types'

/**
 * Watches a folder tree with native file-system events. Reports paths that may
 * need rescanning: audio files, and anything deleted or extension-less (which
 * may be a folder). Returns a function that stops watching.
 */
export async function watchFolder(
  dir: string,
  onPaths: (paths: string[]) => void,
  onError: (error: Error) => void,
): Promise<() => Promise<void>> {
  const subscription = await subscribe(
    dir,
    (err, events) => {
      if (err) return onError(err)
      const paths = events
        .filter((e) => {
          const ext = extname(e.path).toLowerCase()
          return e.type === 'delete' || !ext || AUDIO_EXTENSIONS.has(ext)
        })
        .map((e) => e.path)
      if (paths.length) onPaths(paths)
    },
    { ignore: ['**/.*'] },
  )
  return () => subscription.unsubscribe()
}
