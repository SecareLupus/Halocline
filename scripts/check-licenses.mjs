// Fails if any shipped dependency, in any workspace package, has a licence that
// isn't GPLv3-compatible. Anything bundled into the app belongs in `dependencies`.
// See PLAN.md §9. Add to ALLOWED only after checking compatibility.
import { execFileSync } from 'node:child_process'

const ALLOWED = new Set([
  '0BSD',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  'GPL-3.0',
  'GPL-3.0-only',
  'GPL-3.0-or-later',
  'AGPL-3.0',
  'AGPL-3.0-only',
  'AGPL-3.0-or-later',
  'ISC',
  'LGPL-3.0',
  'LGPL-3.0-or-later',
  'MIT',
  'MPL-2.0',
  'Python-2.0',
  'Unlicense',
])

// Packages whose licence field is missing or non-SPDX but were checked by hand.
const REVIEWED = new Map([
  // 'name': 'reason',
])

const isAllowed = (expr) =>
  expr
    .replace(/[()]/g, '')
    .split(/\s+OR\s+/)
    .some((alt) => alt.split(/\s+AND\s+/).every((id) => ALLOWED.has(id.trim())))

const out = execFileSync('pnpm', ['-r', 'licenses', 'list', '--prod', '--json'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
})
const byLicense = JSON.parse(out)

const bad = []
for (const [license, pkgs] of Object.entries(byLicense)) {
  if (isAllowed(license)) continue
  for (const pkg of pkgs) {
    if (!REVIEWED.has(pkg.name)) bad.push(`${pkg.name}@${pkg.versions.join(',')}: ${license}`)
  }
}

if (bad.length) {
  console.error('Licences not on the GPLv3-compatible allowlist:\n  ' + bad.join('\n  '))
  process.exit(1)
}
console.log('All production dependency licences are GPLv3-compatible.')
