# Halocline

A desktop music player for live streaming. Local files and YouTube Music share one queue,
and everything the UI can do is also available over an HTTP API with a live event stream, so
stream bots can drive it.

> **Status: early skeleton.** Local playback, the queue, the library scanner (tags, cover art,
> folder watching), search and the API work. YouTube Music, the link resolver, autoplay and the
> OBS overlay are still to come.
> See [PLAN.md](PLAN.md) for the design and roadmap.

Targets Linux (Ubuntu) first, then Windows.

## Development

Requires Node 22.12+ and pnpm 9. Linux also needs a C++ toolchain (`build-essential`) and
Python 3 to build `better-sqlite3`.

```bash
pnpm install      # also rebuilds native modules for Electron
pnpm dev          # run the app with hot reload
pnpm test         # unit tests (run under Electron's Node)
pnpm lint && pnpm typecheck
pnpm dist:linux   # AppImage + .deb in apps/desktop/release/
```

### Layout

| Path            | What lives there                                                                |
| --------------- | ------------------------------------------------------------------------------- |
| `packages/core` | Domain layer: zod schemas, SQLite store, library, queue, player, tokens, health |
| `packages/api`  | HTTP API (Hono + OpenAPI 3.1) and SSE event stream over the core services       |
| `apps/desktop`  | Electron app: main process, `track://` protocol, player renderer, Solid UI      |
| `scripts`       | Native rebuild, Electron-as-Node test runner, licence check                     |

### Native modules

`better-sqlite3` is built once, for Electron's ABI, by the `postinstall` script. Tests run under
Electron's bundled Node (`scripts/electron-node.mjs`) so the same binary works everywhere. If
you see a `NODE_MODULE_VERSION` mismatch, run `pnpm install` again.

## API

The app serves the API on `http://127.0.0.1:17380` by default. Create a token in
**Settings → API**, then:

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:17380/v1/player
```

The OpenAPI document is at `/openapi.json`. Live events stream from `/v1/events` as
Server-Sent Events.

## Licence

[GPL-3.0-or-later](LICENSE).
