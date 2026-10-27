import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import solid from 'vite-plugin-solid'

// Workspace packages ship TypeScript source, so they're bundled, not externalized.
// Only native modules (better-sqlite3) need to stay in node_modules at runtime.
const bundleWorkspace = { exclude: ['@halocline/core', '@halocline/api', 'zod'] }

export default defineConfig({
  main: {
    build: { externalizeDeps: bundleWorkspace },
  },
  preload: {
    build: {
      externalizeDeps: bundleWorkspace,
      rollupOptions: {
        // Sandboxed preloads must be CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    plugins: [solid()],
    build: {
      rollupOptions: {
        input: {
          ui: resolve(import.meta.dirname, 'src/renderer/ui/index.html'),
          player: resolve(import.meta.dirname, 'src/renderer/player/index.html'),
        },
      },
    },
  },
})
