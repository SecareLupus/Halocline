# Halocline: notes for Claude

- Design and roadmap: `PLAN.md`. Read the relevant section before changing behaviour.
- Commits are authored as **SecareLupus** (Desmond Duval <haydre@gmail.com>) via the repo-local
  git config. Never commit as Claude and never add a Co-Authored-By trailer. The active `gh`
  account on this machine is a work account; use `GH_TOKEN=$(gh auth token --user SecareLupus)`
  for GitHub calls about this repo.
- `pnpm test` runs Vitest under Electron's Node (`ELECTRON_RUN_AS_NODE`), because
  `better-sqlite3` is compiled for Electron's ABI. Don't run `vitest` with system Node.
- The domain layer (`packages/core`) is the single source of truth. The UI (IPC in
  `apps/desktop/src/main/ipc.ts`) and the HTTP API (`packages/api`) are thin adapters that
  validate with the same zod schemas. A feature lands in both.
- Queue items are addressed by stable IDs, never indexes. Mutations bump `revision`.
- Anything bundled into the shipped app goes in `dependencies` so `pnpm licenses:check` sees it.
- `pnpm test:stream` builds the app and runs the direct YTM engine against fixed tracks
  (`halocline --test-stream`), reporting the failing step. It needs the network, so it's not
  part of `pnpm test`. Run it after touching `providers/po-token.ts`, `providers/ytm-stream.ts`
  or `stream/track-cache.ts`. The `Stream canary` workflow runs it daily on GitHub and keeps an
  issue labelled `stream-canary` open while it fails.
- Before calling something done: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
