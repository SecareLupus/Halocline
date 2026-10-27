// Turns a `halocline --test-stream` report into a GitHub issue (PLAN §4 stream self-test).
// A failure opens an issue labelled `stream-canary`, or comments on the open one; a pass
// closes it. Run from the scheduled workflow with GH_TOKEN and GITHUB_REPOSITORY set.
//
// Usage: node scripts/stream-canary-issue.mjs <report.json> <electron.log> <run-url>
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const LABEL = 'stream-canary'
const [reportPath, logPath, runUrl] = process.argv.slice(2)
const repo = process.env.GITHUB_REPOSITORY

const read = (path) => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}
const gh = (...args) => execFileSync('gh', [...args, '--repo', repo], { encoding: 'utf8' }).trim()

let report = null
try {
  report = JSON.parse(read(reportPath))
} catch {
  // No usable report: the app crashed or never reached the test. Treated as a failure below.
}
const ok = report?.ok === true

const rows = (report?.results ?? []).map(
  (r) =>
    `| \`${r.videoId}\` | ${r.ok ? 'pass' : 'FAIL'} | ${r.step ?? ''} | ${(r.error ?? '').replaceAll('|', '\\|')} | ${r.bytes ?? ''}${r.expected ? ` / ${r.expected}` : ''} | ${r.ms} |`,
)
const body = [
  ok ? 'The stream canary passed again.' : 'The direct engine failed the scheduled stream canary.',
  '',
  `Run: ${runUrl}`,
  '',
  ...(report
    ? [
        '| Video | Result | Failed step | Error | Bytes | ms |',
        '| --- | --- | --- | --- | --- | --- |',
        ...rows,
      ]
    : ['No report was produced. Last lines of the Electron log:']),
  '',
  ...(ok
    ? []
    : [
        '<details><summary>Electron log (last 80 lines)</summary>',
        '',
        '```',
        read(logPath).split('\n').slice(-80).join('\n'),
        '```',
        '</details>',
        '',
        'Reproduce locally with `pnpm test:stream`. Steps: `po_token` (BotGuard / integrity token),',
        '`player` (player request), `decipher` (streaming URL), `sabr` (the audio download).',
        'Fixed means `pnpm test:stream` passes.',
      ]),
].join('\n')

const bodyFile = join(tmpdir(), 'stream-canary-body.md')
writeFileSync(bodyFile, body)

gh(
  'label',
  'create',
  LABEL,
  '--color',
  'B60205',
  '--description',
  'Scheduled stream canary',
  '--force',
)
const open = JSON.parse(
  gh('issue', 'list', '--label', LABEL, '--state', 'open', '--json', 'number'),
)

if (ok) {
  for (const { number } of open) {
    gh('issue', 'comment', String(number), '--body-file', bodyFile)
    gh('issue', 'close', String(number))
  }
} else if (open.length) {
  gh('issue', 'comment', String(open[0].number), '--body-file', bodyFile)
} else {
  gh(
    'issue',
    'create',
    '--title',
    'Stream canary failing: direct YouTube Music engine',
    '--label',
    LABEL,
    '--body-file',
    bodyFile,
  )
}
console.log(body)
process.exitCode = ok ? 0 : 1
