# Halocline

A desktop music player for live streaming. Local files and YouTube Music share one queue,
and everything the UI can do is also available over an HTTP API with a live event stream, so
stream bots can drive it.

> **Status: in development.** Local and YouTube Music playback, the queue, the library (scanner,
> merging, stream-safe tags), the link resolver, autoplay with audio analysis, the OBS overlay and
> the API work. See [PLAN.md](PLAN.md) for the design and roadmap.

Targets Linux (Ubuntu) first, then Windows.

## Development

Requires Node 22.12+ and pnpm 9. Nothing is compiled on install: native modules ship prebuilt
binaries.

```bash
pnpm install
pnpm dev          # run the app with hot reload
pnpm test         # unit tests (run under Electron's Node)
pnpm lint && pnpm typecheck
pnpm dist:linux   # AppImage + .deb in apps/desktop/release/
```

### Layout

| Path                | What lives there                                                                        |
| ------------------- | --------------------------------------------------------------------------------------- |
| `packages/core`     | Domain layer: zod schemas, SQLite store, library, queue, player, tokens, health         |
| `packages/api`      | HTTP API (Hono + OpenAPI 3.1) and SSE event stream over the core services               |
| `packages/analysis` | Audio analysis maths shared with the analysis window: CLAP input features, Camelot keys |
| `packages/overlay`  | OBS overlay renderer: draws an overlay document, in OBS and the editor alike            |
| `apps/desktop`      | Electron app: main process, `track://` protocol, player renderer, Solid UI              |
| `scripts`           | Electron-as-Node test runner, licence check, stream canary issue reporter               |

### Native modules

`better-sqlite3` and `@parcel/watcher` load prebuilt N-API binaries, which work in Node and
Electron alike. Tests run under Electron's bundled Node (`scripts/electron-node.mjs`), the same
runtime as the app.

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
