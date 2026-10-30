// Publishes docs/wiki to the GitHub wiki, a git repository of its own, so the
// wiki is exactly these pages: one deleted here goes there too. The wiki has to
// exist first: GitHub creates its repository with the first page made on the web.
// Pushes with git's usual credentials; on this machine, see CLAUDE.md for the token.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const pages = join(root, 'docs/wiki')
const remote = process.env.WIKI_REMOTE ?? 'https://github.com/SecareLupus/Halocline.wiki.git'

const run = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
// Wiki commits are authored like this repository's, whatever the machine's default.
const author = ['user.name', 'user.email'].flatMap((key) => [
  '-c',
  `${key}=${run(root, 'config', key)}`,
])
const head = run(root, 'rev-parse', '--short', 'HEAD')

const dir = mkdtempSync(join(tmpdir(), 'halocline-wiki-'))
try {
  run(dir, 'clone', '--quiet', remote, '.')
  for (const file of readdirSync(dir)) if (file.endsWith('.md')) rmSync(join(dir, file))
  for (const file of readdirSync(pages)) {
    if (file.endsWith('.md')) cpSync(join(pages, file), join(dir, file))
  }
  run(dir, 'add', '--all')
  if (!run(dir, 'status', '--porcelain')) {
    console.log('The wiki is already up to date.')
  } else {
    run(dir, ...author, 'commit', '--quiet', '-m', `Update from ${head}`)
    run(dir, 'push', '--quiet', 'origin', 'HEAD')
    console.log(`Published docs/wiki at ${head} to the wiki.`)
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
