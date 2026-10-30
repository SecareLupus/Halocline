# Halocline

A desktop music player for live streaming. Local files and YouTube Music share one queue, a
built-in OBS overlay shows what's playing, and everything the app can do is also available over an
HTTP API with a live event stream, so stream bots can drive it.

> **Status: in development.** The current release is
> [0.2.0](https://github.com/SecareLupus/Halocline/releases/latest). Expect rough edges. See
> [PLAN.md](PLAN.md) for the design and roadmap.

Linux (Ubuntu) first, then Windows.

## Features

- **One queue for local files and YouTube Music.** Search both from one box, or paste a YouTube,
  YouTube Music, Spotify, Apple Music, Tidal or Deezer link to play the matching song. Your own
  copy plays when you have one.
- **Library:** music folders are scanned and watched. YouTube Music songs can be saved alongside
  your files, and duplicates merged.
- **Stream-safe mode:** tag the songs you've cleared for stream, and only those can be queued or
  played.
- **Autoplay** keeps the queue going with similar songs, from YouTube Music's radio and audio
  analysis (tempo, key, energy and sound) of your library. **Start radio** sends it somewhere new.
- **OBS overlays** you design yourself: start from a template, then drag, resize and restyle with
  a live preview while OBS redraws. Album art, text with the song, requester and what's next,
  progress bars, your own images, shapes and masks, and rules for when each part shows.
- **HTTP API** with scoped, rate-limited tokens, an OpenAPI 3.1 document, interactive docs and a
  Server-Sent Events stream, for song requests from chat and other bots.
- Crossfade or gapless playback, a choice of output device, shuffle and repeat, and a play history.

## Download

Get the `.deb`, AppImage or Windows installer from the
[latest release](https://github.com/SecareLupus/Halocline/releases/latest). The
[manual](https://github.com/SecareLupus/Halocline/wiki/Installing) has the steps.

## Documentation

The **[user manual](https://github.com/SecareLupus/Halocline/wiki)** is the project wiki:

- [Playing music](https://github.com/SecareLupus/Halocline/wiki/Playing-music),
  [Library](https://github.com/SecareLupus/Halocline/wiki/Library) and
  [Stream-safe mode](https://github.com/SecareLupus/Halocline/wiki/Stream-safe-mode)
- [YouTube Music](https://github.com/SecareLupus/Halocline/wiki/YouTube-Music) and
  [Autoplay and radio](https://github.com/SecareLupus/Halocline/wiki/Autoplay-and-radio)
- [OBS overlays](https://github.com/SecareLupus/Halocline/wiki/OBS-overlays)
- [Bots and the API](https://github.com/SecareLupus/Halocline/wiki/Bots-and-the-API)
- [Settings](https://github.com/SecareLupus/Halocline/wiki/Settings) and
  [Troubleshooting](https://github.com/SecareLupus/Halocline/wiki/Troubleshooting)

## API

The app serves the API on `http://127.0.0.1:17380`. Create a token in **Settings → API**, then:

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:17380/v1/player
```

Interactive docs are at `/docs`, the OpenAPI document at `/openapi.json`, and live events stream
from `/v1/events`. [Bots and the API](https://github.com/SecareLupus/Halocline/wiki/Bots-and-the-API)
covers scopes, song requests and the event stream.

## Development

Requires Node 22.12+ and pnpm 9. Nothing is compiled on install: native modules ship prebuilt
binaries.

```bash
pnpm install
pnpm dev            # run the app with hot reload
pnpm test           # unit tests (run under Electron's Node)
pnpm lint && pnpm typecheck
pnpm dist:linux     # AppImage + .deb in apps/desktop/release/
pnpm wiki:publish   # publish docs/wiki to the GitHub wiki
```

### Layout

| Path                | What lives there                                                                        |
| ------------------- | --------------------------------------------------------------------------------------- |
| `packages/core`     | Domain layer: zod schemas, SQLite store, library, queue, player, overlays, tokens       |
| `packages/api`      | HTTP API (Hono + OpenAPI 3.1) and SSE event stream over the core services               |
| `packages/analysis` | Audio analysis maths shared with the analysis window: CLAP input features, Camelot keys |
| `packages/overlay`  | OBS overlay renderer and editor maths: draws an overlay document, in OBS and the editor |
| `apps/desktop`      | Electron app: main process, `track://` protocol, player renderer, Solid UI              |
| `docs/wiki`         | The user manual, published as the GitHub wiki                                           |
| `scripts`           | Electron-as-Node test runner, licence check, stream canary, wiki publishing             |

### Native modules

`better-sqlite3` and `@parcel/watcher` load prebuilt N-API binaries, which work in Node and
Electron alike. Tests run under Electron's bundled Node (`scripts/electron-node.mjs`), the same
runtime as the app.

### Documentation

The wiki's pages live in `docs/wiki`, so a change to how Halocline behaves updates its manual in
the same commit. Wiki links between pages are written without `.md` (`[Library](Library)`), as the
wiki expects. `pnpm wiki:publish` replaces the wiki with those pages.

## Licence

[GPL-3.0-or-later](LICENSE).
