import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'overlay',
    include: ['test/**/*.test.ts'],
    setupFiles: ['../../scripts/vitest-offline.ts'],
  },
})
