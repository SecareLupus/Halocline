# Halocline: notes for Claude

- Design and roadmap: `PLAN.md`. Read the relevant section before changing behaviour.
- Commits are authored as **SecareLupus** (Desmond Duval <haydre@gmail.com>) via the repo-local
  git config. Never commit as Claude and never add a Co-Authored-By trailer. The active `gh`
  account on this machine is a work account; use `GH_TOKEN=$(gh auth token --user SecareLupus)`
  for GitHub calls about this repo.
- `pnpm test` runs Vitest under Electron's Node (`ELECTRON_RUN_AS_NODE`), so tests run on the
  same runtime as the app. Native modules (`better-sqlite3`, `@parcel/watcher`) load prebuilt
  N-API binaries, which work in Node and Electron alike: nothing is compiled on install, so don't
  add install-time native builds (they broke Windows CI).
- The domain layer (`packages/core`) is the single source of truth. The UI (IPC in
  `apps/desktop/src/main/ipc.ts`) and the HTTP API (`packages/api`) are thin adapters that
  validate with the same zod schemas. A feature lands in both.
- Queue items are addressed by stable IDs, never indexes. Mutations bump `revision`.
- Anything bundled into the shipped app goes in `dependencies` so `pnpm licenses:check` sees it.
- `pnpm test:stream` builds the app and runs the direct YTM engine against fixed tracks
  (`halocline --test-stream`), reporting the failing step. It needs the network, so it's not
  part of `pnpm test`. Run it after touching `providers/po-token.ts`, `providers/ytm-stream.ts`
  or `stream/track-cache.ts`. The `Stream canary` workflow runs it on demand (its schedule is paused:
  YouTube bot-checks GitHub's hosted runners) and keeps an issue labelled `stream-canary` open
  while it fails.
- Audio analysis (PLAN §7) runs in the hidden `renderer/analysis` window: essentia.js plus a
  CLAP model through ONNX Runtime Web. The model is pinned by revision and SHA-256 in
  `main/analysis.ts`. Bump `ANALYSIS_VERSION` (`services/analysis.ts`) whenever results would
  change, so old ones are redone. `@halocline/analysis` must stay pure (no Node or DOM APIs): it's
  bundled into that page and tested under Vitest.
- The OBS overlay (PLAN §8) is a document (`OverlayDocument`, `packages/core/src/overlay`) drawn by
  `@halocline/overlay`, plain DOM with no framework. The API inlines that renderer into its page
  through a `?bundle` import (`scripts/vite-bundle.ts`, a Vite plugin in both electron-vite and
  the api Vitest config). Its pure parts live in `src/state.ts`, which is what's unit-tested.
- Before calling something done: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
