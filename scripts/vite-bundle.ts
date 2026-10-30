// A Vite plugin (electron-vite and Vitest alike) that turns `import code from
// 'x?bundle'` into the string of x's browser bundle. The API inlines the overlay
// renderer into its page this way (PLAN §8).
import { rolldown, type Plugin } from 'rolldown'

const SUFFIX = '?bundle'
const PREFIX = '\0bundle:'

// Typed against Rolldown's plugin API, which Vite's extends, since Vite isn't
// installed at the workspace root. `enforce` puts it ahead of Vite's resolver.
export function bundleAsString(): Plugin & { enforce: 'pre' } {
  return {
    name: 'halocline:bundle-as-string',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!source.endsWith(SUFFIX)) return null
      const entry = await this.resolve(source.slice(0, -SUFFIX.length), importer, {
        skipSelf: true,
      })
      return entry ? PREFIX + entry.id : null
    },
    async load(id) {
      if (!id.startsWith(PREFIX)) return null
      const bundle = await rolldown({ input: id.slice(PREFIX.length), platform: 'browser' })
      try {
        const { output } = await bundle.generate({ format: 'iife' })
        const chunk = output[0]
        // Rebuild in dev when any file in the bundle changes.
        for (const file of chunk.moduleIds) if (!file.startsWith('\0')) this.addWatchFile(file)
        return `export default ${JSON.stringify(chunk.code)}`
      } finally {
        await bundle.close()
      }
    },
  }
}
