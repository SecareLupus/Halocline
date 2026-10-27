// Rebuilds native dependencies against the installed Electron version.
// Runs after every install so dev, tests and packaging share one ABI.
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rebuild } from '@electron/rebuild'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const electronVersion = require('electron/package.json').version

const NATIVE = ['better-sqlite3']

await rebuild({
  buildPath: join(root, 'packages/core'),
  electronVersion,
  onlyModules: NATIVE,
  force: true,
})
console.log(`Rebuilt ${NATIVE.join(', ')} for Electron ${electronVersion}`)
