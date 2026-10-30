import { defineConfig } from 'vitest/config'
import { bundleAsString } from '../../scripts/vite-bundle'

export default defineConfig({
  plugins: [bundleAsString()],
  test: {
    name: 'api',
    include: ['test/**/*.test.ts'],
    setupFiles: ['../../scripts/vitest-offline.ts'],
  },
})
