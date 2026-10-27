import { defineConfig } from 'vitest/config'

// Tests run under Electron's Node (see scripts/electron-node.mjs) so native
// modules like better-sqlite3 only ever need to be built for one ABI.
export default defineConfig({
  test: {
    projects: ['packages/*'],
  },
})
