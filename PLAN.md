# Halocline — Project Plan (draft 3)

Name: **Halocline**, after the layer where fresh and salt water meet. Repo: `github.com/SecareLupus/halocline`.
License: **GPLv3**. Targets: **Linux (Ubuntu) first, Windows second.**

A desktop music player for live streaming:
- YouTube Music is the primary cloud provider, and local files are preferred over cloud copies.
- Local and cloud tracks share one queue.
- Everything is controllable through an API, so external bots can drive it.

## 1. Goals

1. Search YouTube Music **songs only** (no videos) and the library from one search box. Library
   results rank first.
2. Play local files and YTM songs from **one shared queue**.
3. Accept a Spotify, Tidal, Apple Music, YouTube or YTM link and play the matching recording. Use
   the local copy if one exists, otherwise a cloud provider.
4. The **Library** holds local files plus cloud tracks you've added. Library items can be tagged
   **stream-safe**. In stream-safe mode, the API rejects untagged songs and autoplay picks only
   tagged songs.
5. **Two YTM playback engines, both always present:**
   - direct streaming as the primary engine;
   - a hidden YTM window as an automatic fallback.

   When direct streaming breaks, playback keeps working through the fallback until an update
   fixes it.
6. **Autoplay** (a setting, on by default) adds songs *similar to what's playing* to the end of
   the queue.
7. **One API**, designed for this app, with a live event stream.
8. A built-in **OBS now-playing overlay** (§8), served as a Browser Source page. Its layout is a
   document, so it can be customized (the editor is staged in §8).

Non-goals for the MVP: the Pear-parity integrations (ad blocking, SponsorBlock, Tuna, synced
lyrics, Discord Rich Presence), Twitch chat integration, providers other than YTM, mobile apps.
All of these are on the Planned TODO list (§11).

## 2. Architecture

```
┌──────────────────────────── Main process ─────────────────────────────┐
│  Core services (one domain layer, zod schemas shared with the API)    │
│    Queue · Library (SQLite + FTS5) · Scanner · Resolver · Autoplay    │
│    Providers: Local · YTM   [future: others]                          │
│    Stream service: track:// protocol, prefetch cache, engine select   │
│    Analysis worker (BPM, key, loudness, embeddings)                   │
│  Adapters (thin): IPC for the UI · HTTP API · SSE events              │
│  Overlay pages (served by the API server)                             │
└───────┬──────────────────────────────┬────────────────────────────────┘
        │ IPC                          │ IPC
┌───────▼─────────────┐      ┌─────────▼─────────────────────────┐
│ Player renderer     │      │ Hidden YTM window (fallback)      │
│ 2 decks → gain/fade │      │ music.youtube.com, same session   │
│ → output device     │      │                                   │
└───────▲─────────────┘      └───────────────────────────────────┘
        │ state
┌───────┴─────────────┐      ┌───────────────────────────────────┐
│ UI renderer (Solid) │      │ OBS Browser Source                │
│ search · queue ·    │      │ /overlay/now-playing  ◄── HTTP+SSE│
│ library · health ·  │      └───────────────────────────────────┘
│ settings            │
└─────────────────────┘
```

Key decisions:

- **Electron.** The fallback needs a real Chromium with a logged-in YTM session, and one runtime
  covers Linux and Windows.
- **One domain layer.** The UI (over IPC) and the HTTP API call the same services and validate
  against the same zod schemas. Anything the UI can do, the API can do, and the two can't drift
  apart.
- **The player plays every source from a URL on a custom protocol** (`track://<sourceId>`). The
  stream service decides what sits behind it: a local file, a cached file, or a direct YTM
  stream. The player never knows which, so changes to how YouTube streams stay inside one module.
  `track://` answers with CORS approval and the decks request it in CORS mode. The pages are
  another origin, and Web Audio outputs only silence for media it may not read.
- **Audio lives in its own renderer**, separate from the UI, so reloading the UI never drops audio.
- **Two decks** (A/B `<audio>` elements) on one `AudioContext`. This gives gapless playback and
  crossfade. Output device selection uses `setSinkId`. That covers routing to a
  PipeWire/PulseAudio virtual sink on Linux, or a virtual cable on Windows, for OBS.
- **Media controls:** MPRIS on Linux (Electron's built-in `mediaSession` integration first), SMTC
  on Windows.

## 3. Data model

The model rests on one idea: a **Recording** is the song, and a **Source** is a place you can play
it from. Preferring local copies falls out of the model with no special-case code.

```
Recording   id, title, artists[], album, duration_ms, isrc?, artwork,
            in_library, stream_safe, tags[], added_at, play_count, last_played_at
Source      id, recording_id, kind (local|ytm|…), locator (path | videoId),
            format, bitrate, available, failure_count, last_checked
Features    recording_id, bpm, key (Camelot), loudness_lufs, energy,
            embedding (vector), genres[], analyzed_from (local|cache), version
QueueItem   id, recording_id, pinned_source_id?, origin (user|api|autoplay),
            requested_by?, added_at
```

- **Library = Recordings with `in_library = true`.** It's a superset of local files and cloud
  tracks you've added. When a scan finds the same song on disk as a saved YTM song, it attaches a
  `local` Source to the existing Recording (matched by ISRC, else fuzzy match plus duration).
- **Source choice happens at play time:** a pinned source if set, otherwise local, then cache,
  then YTM direct, then the YTM fallback window. Because the choice is made at play time, a dead
  stream falls back without changing the queue.
- **Stream-safe mode** is a player setting. While it's on:
  - Adding an untagged Recording is rejected (API error `stream_safe_violation`).
  - Autoplay picks only stream-safe Recordings. The tag lives on library items, so in practice
    autoplay draws from the library alone in this mode.

Phase 3 as built:
- **Matching** (`packages/core/src/library/match.ts`):
  - ISRC decides when both sides have one.
  - Otherwise the titles must match after normalising: case, accents and punctuation folded,
    featured artists dropped, and neutral qualifiers like "Remastered 2011" or "Explicit" dropped.
    "Radio Edit" and "Live" are kept.
  - At least one artist must match ("- Topic" stripped), and the durations must be within 3 s.
  - The candidate must have no source of that kind yet, so two files never merge.
  - If several recordings fit, the one saved to the library wins. Otherwise there's no merge: a
    missed merge leaves a duplicate, but a wrong one plays the wrong song.
- **Where matching applies:**
  - Scanning a new file attaches it to a matching recording.
  - Queueing or saving a YTM song that matches a local recording adds a `ytm` source to it, so a
    chat request for a song you own inherits its stream-safe tag.
- **Saving:** `POST /v1/library/recordings` takes the same inputs as the queue and saves to the
  library. YTM search results have a Save button, and library rows without a local file show a
  "cloud" badge. Tagging a song stream-safe also saves it.
- **Stream-safe mode in the player:**
  - Untagged songs already queued are skipped, and the queue marks them "will be skipped".
  - Turning the mode on skips an untagged song that's playing.
- **Pinning:** queue items carry their `sources`, and the queue shows a "Play from" menu (Auto,
  Local file, YouTube Music) when there's more than one.
- **Merging and splitting by hand,** for when matching gets it wrong. In the UI, both are in a
  library row's right-click menu. In the API, `POST /v1/library/recordings/{id}/merge` and `…/split`.
  - **Merge** duplicates into one recording:
    - their sources (two files of the same song are allowed) and audio analysis move over;
    - missing details are filled in;
    - in-library and stream-safe are on if any of them had them, tags join and play counts add.
    - Queued items play the kept recording. A merged recording's ID stays usable as an alias of
      the kept one (`recording_aliases`), so API clients and the player don't break.
  - **Split** sources that are a different song onto a new recording:
    - It starts with the original's details and tags, but not its stream-safe flag: it may be a
      different song, so it has to be tagged again.
    - Each side then takes its details from its own sources: a local file's tags (re-read by the
      scan that follows), otherwise YouTube Music's.
    - Queue items pinned to a moved source go back to Auto. Cached link resolutions to the
      original are dropped.
    - At least one source stays on the original.

- **History** (the History button beside Settings): a `plays` table gets a row per track start,
  with the engine, the queue origin and the requester. The migration seeded it with each
  recording's last play. Merges carry plays over. The page fills the window, like Settings. It
  groups plays by day, pages back 50 at a time, offers Next, Add, Save and stream-safe on each, and
  can be cleared (play counts stay, since autoplay uses them). Each row's tags (how it was queued,
  the engine) stack in a fixed-width column, so rows line up however many a song has. The search
  pane stays mounted underneath, so its results survive.

- **Window layout** (`renderer/ui`): search beside the queue, with a draggable split (remembered,
  double-click to centre). Below 720 px wide they stack, search over the queue, and the player
  bar moves shuffle and repeat into a column with the volume. The window goes down to 420 px.
  - Row buttons are only Save, Next, Add (and ✕ in the queue), shown on the row under the pointer
    or in focus. Anything more goes on the row's right-click menu, never another button. Every
    row's menu repeats its buttons' actions too; songs in search and
    history add **Start radio** (§7).
  - Clicking the bar's art opens the **player view**: big art, progress and controls, the queue
    below, no search. The faint ⌄ in its corner (or Escape) goes back.

Storage:
- SQLite (`better-sqlite3`) with FTS5 over title, artist and album.
- Vector similarity via `sqlite-vec`, or brute-force cosine search in memory, which is fine at 10k
  tracks.
- `music-metadata` reads tags. `@parcel/watcher` watches folders on Linux and Windows.
- The first scan runs in a worker thread with progress shown in the UI; later scans are
  incremental (mtime + size).

## 4. YouTube Music provider

**Search:** `youtubei.js` music search filtered to songs. When a YouTube *video* link comes in,
it's converted to the matching song (§5).

**Auth:** an in-app Google sign-in on a persistent session partition. The cookies feed
`youtubei.js`, and the hidden window shares the same partition, so Premium applies to both
engines.

**Channels:** a Google account can manage brand channels besides its own, and a parent's account
also lists the family's children's profiles.
- The status names the channel YouTube marks selected, not the first one listed: children's
  profiles come first in the TV client's list.
- Settings → YouTube Music → "Use as" picks among the channels in YouTube's channel switcher
  (`GET /v1/ytm/accounts`, `PUT /v1/ytm/account`).
- The choice is kept in the `ytm_account` kv key as `authuser:pageId`.
  - Search and the direct engine pass it to youtubei.js as `account_index` and
    `on_behalf_of_user`.
  - The fallback window's session loads that channel's own switch URL from the list, so its next
    page plays as it.
  - Signing out, or the channel disappearing from the list, goes back to the account's own.

**Engine 1: direct.** `youtubei.js` player data, plus a PO token (`bgutils-js`), plus SABR/UMP
handling (`googlevideo`). The stream service serves the result as a plain byte stream behind
`track://`. Ads don't apply on this path because we fetch the audio stream ourselves.
- Google's scripts (the BotGuard challenge and the player's URL decipher) run in a hidden,
  sandboxed window on www.youtube.com, on the YTM session, with no preload and no Node. They never
  run in the main process.
- The BotGuard challenge comes from the youtube.com page, as in the web player. A generic challenge
  from the `Create` endpoint mints tokens the server never accepts (stuck at "pending").
- The PO token is minted up front and bound to the videoId. The integrity token is reused until its
  TTL runs out.
- Every direct stream goes through the track cache, so a track plays while it downloads and
  seeking works. Cold start is about 6 to 8 s, most of it a backoff the server asks for on the first
  SABR request. Prefetch hides that for queued tracks.

**Engine 2: hidden window.** music.youtube.com in a hidden `BrowserWindow`. Its job is to load a
videoId, play it, and report position and end-of-track. Its output goes to the same selected
device. Crossfade between the engines uses timed gain ramps over IPC.
- Ad blocking is on the Planned TODO list, not the MVP. With Premium, the fallback plays no ads.
- Without Premium, ads can play in this engine, so it must detect YTM's ad state and report it as
  `ad`, not as song progress. The queue, overlay and API then never show an ad as the track.
- As built:
  - Main keeps a target state (video, start position, play/pause, volume, seek, output device). The
    window's preload drives the page's own `<video>` towards it and reports back. The preload
    runs in an isolated world and exposes nothing to the page.
  - Each track is a fresh load of `music.youtube.com/watch?v=…`.
  - Ads are spotted by the YouTube player's `ad-showing` / `ad-interrupting` classes. During an ad
    the song's clock is frozen, and the start position is applied only once the song itself plays.
  - When YTM moves on to its own autoplay pick, the preload keeps it paused. The core decides what
    plays next.
  - The output device is matched by label, because device IDs differ per origin. The YTM session's
    permission check lets only this window list and pick audio outputs, and nothing is granted on
    request.
  - A core `EngineRouter` sends each command to the active engine, and loading on one stops the
    other. Reports from the inactive engine are dropped.
  - A load that doesn't start playing within 20 s of song time (ads excluded) reports an error.
  - Not built yet: the crossfade between engines (a switch is a cut).
  - The EU cookie consent page is out of scope: Halocline isn't used in the EU.

**Engine selection:**
- Try direct streaming. On failure (setup error, stall, HTTP error), switch to the fallback within
  the same track and resume at the same position.
- After 3 direct failures in a row, a circuit breaker routes straight to the fallback for 30
  minutes, then tries direct again. This avoids paying the failure delay on every song while
  direct is broken.

**Prefetch cache:**
- Once the current track starts, prefetch the next cloud track in the queue to an LRU disk cache.
  When the player cues a track for the direct engine, it's prefetched.
- Prefetching via the direct engine only; the fallback engine can't prefetch.
- The cache lives in `<userData>/track-cache`, defaults to 1 GB, and never evicts a track used in
  the last 15 minutes.
- This hides network blips. The analysis worker also uses the cached file.

**Health indicator:**
- Each track shows an engine badge: `local`, `cache`, `direct` or `fallback`.
- A footer status dot:
  - green: direct streaming is working;
  - amber: the fallback was used recently;
  - red: the circuit breaker is open.
- Its tooltip reads "Direct streaming is failing; check for an update" and shows the last error.
- The same information is available as `GET /health` and a `health.changed` event.

**Stream self-test (supports fast fixes):**
- `pnpm test:stream` runs the direct engine against a small, fixed set of videoIds and reports
  what failed at which step (player data, PO token, decipher, SABR). It runs the built app with
  `--test-stream` and reads each track to the end, past the one-minute cold-start allowance.
- `.github/workflows/stream-canary.yml` runs it under Xvfb with Chromium's sandbox on. A failure
  opens an issue labelled `stream-canary`, or comments on the open one. A pass closes it.
- The schedule is paused, so for now it runs only on demand. YouTube refuses GitHub's hosted runners
  with `LOGIN_REQUIRED` ("Sign in to confirm you're not a bot"), so a scheduled run there only
  reports the runner's IP. The plan is to restore the daily schedule on a self-hosted runner on a
  home connection.
- Run in CI on a schedule, a failure opens an issue with that output. An agent picking up the issue
  has a reproducible failure and a clear definition of "fixed".
- This is a canary, not a decision gate.

## 5. Link resolver

Pipeline: **parse, then fetch metadata, then normalize, then match against the library, then match
against YTM, then score.**

| Input | Metadata (self-contained) |
|---|---|
| YTM `music.youtube.com/watch?v=` | videoId directly. A music *video* is mapped to its song counterpart |
| YouTube `youtube.com/watch`, `youtu.be` | same as above. With no counterpart, search YTM songs using title, artist and duration |
| Spotify `open.spotify.com/track/…` | public page meta tags (title, artist, duration). Optional Spotify API client credentials add the ISRC |
| Tidal `tidal.com/…/track/…` | public page meta tags |
| Apple Music `music.apple.com/…?i=` | iTunes Lookup API (no key) |
| Anything with title + artist but no ISRC | Deezer public API (no key) to fill in the ISRC |

Matching:
1. **ISRC exact match**, against the library and then YTM.
2. **Fuzzy match.** Normalize first: strip "(Official Video)", "Remastered 2011" and "feat. X", and
   fold case and accents. Then score artist and title with Jaro-Winkler, requiring the duration
   within ±3 s.
3. **A confidence threshold decides the outcome.** Above it, the song is enqueued. Below it, the
   API returns the candidates (§6), so a wrong song never plays silently.
4. Resolutions are cached by URL.

There's no third-party link-matching fallback. Odesli (song.link) closed its public API in 2026 and
stopped issuing keys; the paid replacements (MusicLink, Musicfetch) aren't worth a key for the few
links Deezer plus YTM search can't settle, which get candidates instead.

As built (`packages/core/src/resolve/`):
- **Reading links:**
  - Spotify and Tidal give their link-preview tags (title, artists, album, duration) to a client
    that identifies itself, here as "Halocline … (link preview)". A browser user agent gets only
    a script shell.
  - Apple uses the iTunes Lookup API and Deezer its public track API. YouTube links go through
    youtubei.js, splitting upload titles like "Artist - Title (Official Video)".
  - Deezer's public search fills in a missing ISRC and duration. With no duration (Tidal) it takes
    an exact title and artist, since nothing else can be confident.
- **Scoring:**
  - Matching ISRCs score 1.
  - Durations more than 3 s apart score 0. An unknown duration caps the score at 0.85, below
    confident.
  - Otherwise 65% title and 35% best artist pair (Jaro-Winkler), after normalising (featured
    artists, remaster notes and video decorations dropped).
  - Extra words in one title ("Radio Edit", "Live") cap the title part, so another version is
    never confident.
  - Confident is ≥ 0.9; candidates are ≥ 0.6.
- **Precedence:** a confident library match, then a linked YTM song as it is, then YTM's song for
  a linked video, then the linked video itself (it's exactly what was asked for).
- **API:**
  - `POST /v1/resolve` previews without enqueueing.
  - `POST /v1/queue/items` and `POST /v1/library/recordings` resolve links the same way.
  - Anything short of one confident answer is `422 match_ambiguous` with `candidates`. Each has an
    `input` to send back.
- **UI:** pasting a link into the search box shows what it was read as, the match, and the
  alternatives with their scores.
- **Cache:** confident matches only, keyed by provider and track ID, so tracking parameters don't
  matter. A library match whose recording is gone is dropped.
- **Not built:** the optional Spotify API credentials for ISRCs. Deezer supplies them.

## 6. API

The API is designed for this app from the ground up. It's an HTTP JSON API with a
Server-Sent Events stream, and its OpenAPI 3.1 document is generated from the same zod schemas
the domain layer uses (Hono + `@hono/zod-openapi`, with interactive docs served by the app).
As built: Swagger UI at `/docs` (linked from Settings → API, as is the server's address, which
redirects there), from `swagger-ui-dist` bundled into
the app rather than a CDN, so it works offline under a strict CSP. Reading needs no token;
**Authorize** takes an API token for **Try it out**.

**Conventions:**
- Resource-oriented URLs.
- Queue items are addressed by **stable IDs, never by index**, because a bot and the UI editing
  the queue at the same time would otherwise move the wrong item.
- The queue carries a `revision` number; mutations accept an `If-Match` header for optimistic
  concurrency.
- Errors use RFC 9457 `application/problem+json` with machine-readable `type` codes:
  `stream_safe_violation`, `match_ambiguous`, `not_found`, `provider_unavailable`.
- List endpoints use cursor pagination.
- The `/v1` path prefix exists only for future breaking changes.

**Resources (sketch):**

| Method & path | Purpose |
|---|---|
| `GET /v1/player` | state: track, position, playing, volume, engine, repeat, shuffle |
| `PATCH /v1/player` | set playing, volume, position, repeat, shuffle. `repeat: all` puts each song, finished or skipped, back on the end of the queue (keeping its requester and pinned source; failed songs aren't, so nothing loops on an error), `one` replays the song, and `shuffle` plays a random queued song next (picked when cued, so gapless preloading still holds). The volume is remembered between runs. The player page reports the queue item it's playing with its progress; if that differs from Now Playing for more than 2 s after a change (a race between the page moving on and a change from the core), the core reloads Now Playing on it and logs `[player] … resyncing` |
| `POST /v1/player/next` · `/previous` | transport |
| `GET /v1/queue` | items + revision |
| `POST /v1/queue/items` | `{ input: url \| query \| recordingId, position: next \| end \| {after: itemId}, requestedBy? }`. Resolves and enqueues in one call. `201` on success, `409 stream_safe_violation`, `422 match_ambiguous` with candidates |
| `PATCH /v1/queue/items/{id}` | move or pin a source |
| `DELETE /v1/queue/items/{id}` · `DELETE /v1/queue/items` | remove or clear |
| `POST /v1/queue/radio` | `{ input, requestedBy? }`: Start radio (§7). Clears the queue, queues the song, fills to "Keep queued" whatever the autoplay switch says, and returns the new queue (`queue:manage`) |
| `GET /v1/search?q=&scope=library\|ytm\|all` | unified results; each carries `recordingId` (or a provider ref) and its available sources. YTM albums and playlists come last (`ytm-collection`, up to four of each) |
| `GET /v1/collections/{ref}` · `POST /v1/queue/collections` | an album's or playlist's tracks (`ytm-album:…`, `ytm-playlist:…`; playlists cut at 500); enqueue all of it in order, as one change. `POST` also takes a YouTube Music album or playlist link (an album's Share link, `playlist?list=OLAK5uy_…`, is looked up as the album). YouTube Music's playlist page names no owner, so a playlist opened this way is described by its tracks' artists ("Daft Punk", or "Daft Punk, Justice & 12 more"). In stream-safe mode untagged songs are left out and counted in `skipped`. `POST /v1/queue/items` refuses such links with a pointer here |
| `POST /v1/resolve` | link to a match or candidates, without enqueueing |
| `GET /v1/library/recordings` · `PATCH /v1/library/recordings/{id}` | browse; add or remove from library; set `stream_safe` and tags (with a bulk variant) |
| `GET /v1/analysis` | audio analysis progress (§7) |
| `GET /v1/history?limit=&before=` · `DELETE /v1/history` | recently played, latest first: when, engine, and how it was queued (`user`/`api`/`autoplay`, `requestedBy`); clear it (admin; play counts stay) |
| `POST /v1/library/recordings/{id}/merge` · `/split` | merge duplicates into this recording; split sources off onto a new one (§3) |
| `GET /v1/artwork/{recordingId}?size=` | album art: art embedded in local files is extracted at scan time, YTM thumbnails are proxied and resized. Cached either way |
| `GET /v1/health` | engine status, last errors, scan progress |
| `GET /v1/settings` · `PATCH /v1/settings` | stream-safe mode, autoplay options, and more |
| `GET /v1/events` | SSE: `player.changed`, `track.changed`, `queue.changed`, `library.changed`, `health.changed` |

**Why SSE over WebSocket:**
- The event stream only flows one way, and commands go over REST.
- SSE is plain HTTP, so the same auth middleware applies.
- `Last-Event-ID` gives resume-after-reconnect for free.
- Any bot language can consume it.

**Auth:**
- Named bearer tokens created and revoked in Settings.
- Each token has **scopes**: `read`, `player:control`, `queue:add`, `queue:manage`,
  `library:write`, `admin`, `overlay`.
- Each token has an optional rate limit. A future Twitch chat bridge gets `queue:add` only.
- **Overlay tokens:** OBS Browser Sources and `EventSource` can't send auth headers.
  - The API accepts a `?token=` query parameter, but **only for `overlay`-scoped tokens**.
  - An overlay token can read player state, the current track and artwork, and nothing else.
  - It ends up stored in OBS scene files, so it must be harmless if leaked.

**Network:**
- The server binds to `127.0.0.1` by default; the bot runs on the same machine for now.
- **CORS allows any origin**, so browser-based bots (e.g. Twitchat's HTTP trigger) can call it.
  This is safe because auth is a bearer token, never a cookie: a page can only use a token it
  was given. Preflights are answered before auth, and also allow Chrome's Private Network Access.
- The bot will later move to a network server, so remote access is designed in from the start,
  not added later:
  - a bind address setting;
  - TLS (cert/key paths, or a generated self-signed cert with its fingerprint shown in Settings);
  - tokens that are never sent over plain HTTP to non-loopback addresses unless explicitly
    allowed;
  - every token is scoped from day one, so the remote bot's token can be limited to what it needs.

## 7. Autoplay (similar-song continuation)

Setting: **autoplay on by default.** When the queue drops below N items (default 2), the
recommender appends songs similar to what's playing. Options include the following:
- Sources to draw from: library only, or library + YTM.
- An adventurousness slider.
- An artist-repeat window.

It follows the usual two-stage recommender pattern: **generate candidates, then re-rank.**

**Candidate generation:**
- Library neighbours of the current track and the last few tracks, by audio-embedding similarity.
- YTM's own radio/up-next for the current song (cloud; skipped in stream-safe mode).
- Same artists and related artists (ListenBrainz similar-artist data, an open dataset; optional).
- YTM radio results also supply YTM's rank for each candidate; see "Tracks without features"
  below.

**Re-ranking:** a weighted score.
- Embedding cosine similarity (overall timbre and style).
- Tempo closeness, allowing half and double time.
- Harmonic compatibility on the **Camelot wheel**: same key, ±1, or relative major/minor. This is
  the standard rule DJs use for smooth key transitions.
- Energy and loudness continuity.
- Genre and tag overlap.

**Constraints:**
- Stream-safe filter when the mode is on.
- No repeat of an artist within the last K tracks.
- Nothing played in the last X hours.
- A little randomness (sampling from the top-k rather than taking the top-1), so it doesn't loop
  the same path.

**Audio analysis:** **Essentia** (AGPLv3, combinable with GPLv3) with its pretrained models:
Discogs-EffNet embeddings plus genre and mood classifiers. It gives BPM, key, loudness, embeddings
and genres.
- It runs as a sidecar process (Python wheel or native CLI) in a background queue.
- **Sources of audio:** local files (analyzed during scanning) and the prefetch cache. There's no
  separate download for analysis, so a cloud track is analyzed only after it has been cached
  (played or prefetched).
- Results are stored in `Features` with an analyzer `version`, so a better model can re-analyze
  later.

**Tracks without features** (uncached cloud tracks, or local tracks not yet analyzed) are still
eligible. They're scored from what's known without audio:
- **YTM's ranking.** A candidate's position in YTM's radio/up-next for the current or recent
  tracks becomes a similarity score, so YTM's recommender stands in for our audio comparison.
- Metadata: artist and related-artist overlap, genre tags, release year.

Each source of evidence carries a confidence weight, so analyzed and unanalyzed candidates rank
on one scale. Once a track is played or prefetched, it's analyzed, and later rankings use its real
features.

Phase 5, first part, as built (`services/autoplay.ts`, `autoplay/rank.ts`): autoplay without
audio analysis, scored as "tracks without features" above.
- **When:** on queue, track and settings changes, while autoplay is on and the queue is shorter
  than "Keep queued". The seed is the last song in the queue, since new songs follow it; the one
  playing when nothing is queued. While the player is on repeat it doesn't add anything: the queue
  goes round, and new songs would only grow the loop. Plays are counted when a track starts (`play_count`,
  `last_played_at`), which gives the recent-artist and recent-song history. The queue pane has an
  Autoplay switch (the same `autoplay.enabled` setting).
- **Candidates:**
  - YTM's radio (up-next with automix) for the seed, through its YTM source or a search for it.
    Radio songs already in the database count as those recordings, so in library-only or
    stream-safe mode the radio still ranks your own songs.
  - Library songs by the seed's or recent artists, or sharing its tags, plus a random handful so
    autoplay never runs dry.
- **Score:** the weighted mean of the evidence a candidate has. YTM radio position counts 1,
  artist overlap 0.5 (1 for the current artist, 0.6 for a recent one), tag overlap 0.4. Saved or
  owned songs get +0.05.
- **Limits:**
  - Hard: stream-safe mode, not queued already, not the song playing. Cloud songs need the "Library
    and YouTube Music" setting, stream-safe mode off and a playback engine.
  - Soft, given up in this order if nothing is left: the artist gap (default 3 songs), then
    the recent-song window (default 3 hours).
- **Pick:** from the top 2–20 (by adventurousness), with odds flattening as adventurousness
  rises.
- **Settings:** on/off, songs to keep queued, sources, adventurousness, artist gap, recent hours.
  They're part of `GET`/`PATCH /v1/settings`, and Settings → Autoplay in the UI. Turning autoplay
  off leaves the others as they are, and they can still be changed. (A settings patch changes only
  the fields it names; parsing used to fill the rest of a group with defaults.)
- **Start radio** (`AutoplayService.startRadio`, `POST /v1/queue/radio`, right-click → Start
  radio): replaces the queue with one song, as one change, then fills it to "Keep queued" from
  that song, whether autoplay is on or not (and on repeat too). The song playing keeps playing.
  A fill already under way for the old queue is dropped.

Phase 5, second part, as built: audio analysis. The Essentia plan above changed after two
findings. Essentia's Python packages are published for Linux and macOS only, and its pretrained
models (Discogs-EffNet, genre and mood heads) are CC BY-NC-SA 4.0, non-commercial, which doesn't
fit a GPLv3 app. Instead, with nothing native or Python:
- **Where:** a hidden analysis window (`renderer/analysis`), opened when there's work and closed
  after a minute idle. It gets each job's encoded audio over IPC: a local file, or the cached
  download. Chromium decodes it, so any format the player plays can be analyzed.
- **Measurements** with **essentia.js** (AGPLv3, WebAssembly):
  - tempo: RhythmExtractor2013, `degara` method (it agreed with `multifeature` and is about
    six times faster);
  - key: KeyExtractor, written in Camelot notation;
  - loudness: EBU R128 integrated LUFS;
  - energy: a heuristic from loudness and onset rate, 0 to 1 (`@halocline/analysis`).
- **Sound embedding:** the CLAP audio encoder of `laion/larger_clap_music_and_speech`
  (Apache-2.0), in Xenova's quantized ONNX conversion (78 MB), run by **ONNX Runtime Web**
  (MIT, WASM, one thread).
  - It's downloaded from Hugging Face the first time something needs analyzing, pinned to one
    revision and checked by SHA-256, into `<userData>/models`.
  - Input features are computed by `@halocline/analysis` to match Hugging Face's
    ClapFeatureExtractor. They agree within 4×10⁻⁶ dB, and the embeddings with Python's reference
    to cosine 0.9999.
  - Three 10 s excerpts (at 30%, 50% and 70% of the track) are embedded and averaged, giving a
    512-dimensional unit vector. With this model, different kinds of music score below about 0.4
    cosine, songs of one style 0.6 to 0.75, and versions of one song above 0.9.
- **Speed:** about 8 s per 3-minute song on one thread, in the background.
- **Queue** (`services/analysis.ts`):
  - One track at a time: library local files first, then cloud tracks already in the prefetch
    cache. Tracks over 20 minutes are skipped.
  - Results go in `features` with `ANALYSIS_VERSION`. A track that can't be decoded is stored as
    failed and not retried until the version changes. An unavailable analyzer (no model, a closed
    window) just pauses the queue.
  - It waits while music plays, since a busy CPU core could make a live stream stutter. A
    track already being analyzed finishes; the rest resume when playback stops or pauses.
    "Keep analyzing while music plays" (`analysis.duringPlayback`, off by default) lifts this.
  - Settings → Audio analysis turns it off (`analysis.enabled`) and shows progress, also at
    `GET /v1/analysis` and as `analysis.changed` events.
- **In autoplay:**
  - Library songs that sound like the seed (nearest embeddings) join the candidates.
  - Analyzed candidates get audio evidence: sound (weight 1), tempo with half and double time
    (0.3), Camelot compatibility (0.3), energy (0.3) and loudness (0.1).
  - Another version of a song just played (a remix, a cover: the same title without its
    version notes) is never picked.
- **Packaging:** Vite bundles essentia.js and ONNX Runtime into the analysis page, so their
  node_modules copies (150 MB) are left out of the app (`electron-builder.yml`).

## 8. OBS now-playing overlay

An overlay is a **document**: a JSON description of a fixed-size canvas and the elements on it.
One renderer draws a document, both in OBS and (later) in the editor's preview, so the editor
can't drift from what OBS shows. Halocline ships one document, **Classic**, and serves it at
`/overlay/now-playing?token=<overlay token>`. It's added to OBS as a **Browser Source** with a
transparent background.

### Document

`OverlayDocument` (zod, `packages/core/src/overlay`):

```
OverlayDocument {
  version: 1
  canvas: { width, height }       design size in px (Classic: 375×140)
  fadeMs                          show/hide and track-change cross-fade (300)
  hideAfterPausedMs | null        a pause this long reads as stopped (5 minutes)
  elements: OverlayElement[]      paint order: the first is at the back
}

every element: id, x, y, width, height, opacity
  rect      fill, radius
  art       placeholder, radius, pausedShade, pauseSign (colour, or null for none)
  text      text (template), font, size, weight, color, align, shadow, minScale
  progress  fill, pausedFill, track, edge
```

- **Geometry** is in canvas pixels. The page scales the whole canvas to fit the source, keeping
  its aspect ratio, anchored top-left. Set the Browser Source to the canvas size and it's 1:1.
  A source of another shape gets the canvas scaled, not reflowed.
- **Ids** are short slugs (`[a-z][a-z0-9-]*`), unique in the document. Each element gets the class
  `hl-<id>`, so OBS Custom CSS can target it.
- **Colours, fonts and shadows** are CSS values. The renderer sets them through the CSSOM, never
  by writing CSS text, so a document can't inject rules.
- **Text templates:** `{title}`, `{artists}` (joined with ", ") and `{album}`. Anything else is
  literal. A text element is one line, vertically centred in its box. Too long for its box, it
  shrinks to fit, down to `minScale` of its size, before an ellipsis cuts it off.
- **Versioning:** `version` is bumped on any change old documents need migrating for. Adding an
  optional field with a default isn't one.

### Classic

```
┌──────────┬───────────────────────────────────────────┐
│          │  Artist                                   │
│   art    │  Song Title                               │
│          │                                           │
├──────────┴───────────────────────────────────────────┤
█████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  ← progress bar
```

- **Panel** (`panel`): 375×130 behind the art and text, black at 70%, so the scene shows through
  faintly while the text stays legible.
- **Art** (`art`): 130×130 at the left edge. Missing art shows a neutral placeholder.
- **Artist** (`artist`) and **title** (`title`): one line each, 146 px from the left with a 16 px
  right margin, centred together above the bar. The title is 22.5 px semibold, the artist 18 px at
  85% opacity, both with a soft shadow.
- **Progress bar** (`bar`): the full width along the bottom, 10 px tall. The whole track always
  shows (dark and translucent with a light edge, so it reads on any scene); the played part fills
  in seafoam, Halocline's accent.

### Behaviour

The same for every document:
- **Data:** on load the page fetches `GET /v1/player`, then subscribes to `/v1/events` for
  `player.changed` and `track.changed`. If the connection drops, it reconnects and fetches the
  state again.
- **Progress:** events carry `positionMs` plus a timestamp, and the page moves the bar forward
  locally between events. It stays smooth with no per-frame events, and resyncs on every event
  (seeks included).
- **Paused:** progress fills turn `pausedFill` and freeze; art darkens under `pausedShade` with
  a pause sign. The song and its progress stay.
- **Stopped:** paused for longer than `hideAfterPausedMs` reads as stopped, and the overlay fades
  out. That covers the start of a stream (Halocline has been idle at least that long) without a
  switch to remember; guessing wrong only hides the overlay early. `PlayerState.pausedAt` (when
  playback paused, null while playing) lets a page loaded mid-pause tell how long it's been.
- **Track change:** art and text cross-fade. Each keeps two copies, and the hidden one is filled
  before they swap.
- **Nothing playing, or a fallback-engine ad:** the whole overlay fades out.

### Restyling from OBS

OBS's Browser Source has a **Custom CSS** field. Elements keep their `hl-<id>` classes, and the
renderer's own rules go first in `<head>` with the lowest specificity that works, so a Custom CSS
rule like `.hl-title { color: gold }` wins. Classic's ids match the old page's classes (`.hl-art`,
`.hl-artist`, `.hl-title`, `.hl-bar`). The old page's CSS custom properties (`--hl-bar-color`
and friends) are gone: the editor replaces them.

### Settings → Overlay

A "Copy overlay URL" button. It creates the `overlay` token on first use, copies the URL, and
shows the canvas size to set on the Browser Source.

### As built

- `@halocline/overlay` (`packages/overlay`) is the renderer: plain DOM, no framework, so the OBS
  page stays light and the Solid editor can embed it. `mountOverlay(root, doc)` draws a document;
  `connectLive` feeds it from the API; `src/state.ts` holds the pure parts (visibility, progress,
  templates) and is unit-tested.
- The API inlines the renderer into the page as one script. `scripts/vite-bundle.ts` is a Vite
  plugin (used by electron-vite and Vitest alike) that turns an import ending in `?bundle` into
  the string of its Rolldown bundle.
- The page's CSP allows only that inline script, by hash. Styles stay open, because OBS injects
  Custom CSS as a `<style>` element. The document travels in the page as a JSON data block,
  which isn't executed.
- `Referrer-Policy: no-referrer` keeps the token out of image requests.
- Local cover art comes from `GET /v1/artwork/{hash}` (`read` or `overlay` scope). YouTube Music
  art loads directly from Google's image hosts.
- The overlay token's secret is kept (in `kv`), unlike other tokens, so the URL can be copied
  again. It can only read what's playing.
- `GET /v1/overlay` and `POST /v1/overlay/rotate` (admin) are the API side of the Settings button
  and its "New URL…" (rotate) button.
- The UI copies the URL and never displays it, in case Settings is on stream.
- Clocks: the bar extrapolates from `positionAt`. That's safe because the API binds to loopback,
  so OBS runs on the same machine.

### Editor roadmap

Each stage builds on the document model, so none is thrown away.

- **A. Document and renderer** *(done)*: the model above, Classic as a document, the shared
  renderer. No visible change apart from the scaling rule.
- **B. Storage, API and live updates:**
  - An `overlays` table (id, name, document, `revision`), not part of `Settings`: a document is
    replaced whole, and settings patches merge field by field.
  - `/v1/overlays` CRUD (admin) plus the matching IPC, each validated with `OverlayDocument`.
  - Each overlay at `/overlay/{id}?token=…`. `/overlay/now-playing` stays as the default
    overlay's address. The page loads its document from the API rather than having it inlined.
  - An `overlay.changed` event, so OBS redraws while you edit.
- **C. Property-panel editor:** a Solid page with a few built-in templates (Classic plus two or
  three), a property panel and a live preview through the same renderer. A sample-state switcher
  covers the edge cases: playing, paused, a long title, no art, several artists.
- **D. Freeform canvas:** drag, resize, snapping and multi-select with Moveable/Selecto; layer
  order; undo/redo as a stack of document patches; JSON import and export (validated, so an
  imported document can't break the page).
- **E. More elements:** up next, requester, the current lyric line, the pause note (§11), images
  (stored content-addressed, like artwork), and a visualizer (needs frequency data from Halocline
  over a WebSocket). A single-element document doubles as a widget URL.

Fonts: the page's CSP blocks web fonts, but installed fonts work by name, and the editor can list
them with `queryLocalFonts()`.

### Extension points

Used by the API and overlay now, and by the planned integrations later: integrations attach to
internal hooks, so adding one doesn't touch core code.
- Lifecycle: `onTrackChange`, `onPlayerChange`, `onQueueChange`.
- `registerRoutes(scope)`.
- A zod settings schema, from which the settings UI is generated.
- Not a public third-party plugin system in v1.

## 9. Licensing

- The project is **GPLv3**.
- Pear Desktop is MIT. Any reused file keeps its MIT copyright and permission notice; a
  `THIRD_PARTY_NOTICES` file lists each one. MIT code may be included in a GPLv3 work.
- Dependencies must be GPLv3-compatible:
  - MIT, BSD, ISC and Apache-2.0 are fine.
  - MPL-2.0 (the ghostery adblocker, once the planned ad blocking is built) is fine.
  - AGPLv3 (essentia.js) is combinable with GPLv3.
- Models are data, not dependencies, so the licence checker doesn't see them; check them by hand.
  The CLAP model is Apache-2.0 and is downloaded at run time, not shipped. Essentia's own models
  (CC BY-NC-SA) were ruled out.
- CI runs a license checker that fails on anything incompatible.

## 10. Phases

No decision gates. Both YTM engines are in scope from the start.

**Phase 1: core.**
- Domain layer and SQLite schema.
- Library scanner and watcher, FTS search.
- Queue service (persisted, survives restart).
- Two-deck player renderer and output device selection.
- Minimal UI: search, queue with drag reorder, now playing, settings.
- The API skeleton (auth, tokens/scopes, player, queue, search, SSE) built alongside the UI, so
  every feature lands in both from day one.

**Phase 2: YTM.**
- Sign-in.
- Song search.
- **Both engines**, with in-track failover and the circuit breaker.
- Prefetch cache.
- Health indicator.
- Ad-state detection in the fallback engine.
- `test:stream` canary in scheduled CI.

**Phase 3: library superset and stream-safe.**
- Add cloud tracks to the library.
- Merge Recordings across sources.
- Bulk stream-safe tagging.
- Stream-safe mode enforced in the API and the queue.
- Source pinning.

**Phase 4: link resolver.**
- Parsers and metadata fetchers.
- Matcher and the candidate flow.
- Resolution cache.

**Phase 5: autoplay.**
- Analysis sidecar.
- Features store.
- Candidate generation and re-ranking.
- Settings.

**Phase 6: OBS overlay.**
- The artwork endpoint, `overlay` tokens, the now-playing page and the Settings → Overlay panel.
- It depends only on Phases 1–2 (player events and the YTM thumbnails), so it can move earlier if
  you want it on stream sooner.

**Packaging, throughout:**
- Linux: AppImage + `.deb` as the primary targets.
- Windows: NSIS installer, built and smoke-tested in CI from Phase 1.

## 11. Planned TODO (post-MVP)

**Pear-parity integrations.** These are fresh implementations unless reuse is clearly better.
Each attaches through the §8 extension points.
- **Ad blocking:** only needed on the hidden YTM window's session. Use
  `@ghostery/adblocker-electron` because it's the right tool, not because Pear uses it.
- **SponsorBlock:** fetch `music_offtopic` segments for YTM tracks (privacy-preserving hash-prefix
  lookup) and skip them in either engine. It doesn't apply to local files.
- **Tuna (OBS):** POST now-playing JSON to the Tuna OBS plugin's local web server, for existing
  Tuna-based scenes. The built-in overlay covers new setups.
- **Synced lyrics:**
  - Local first: embedded `SYLT`/`USLT` tags or a sidecar `.lrc` file.
  - Then LRCLIB (open, free).
  - Then YTM's own lyrics for cloud tracks.
  - Pear's provider code is worth reading for edge cases (time offsets, romanization); reuse
    selectively.
- **Discord Rich Presence:** via `@xhayper/discord-rpc`. Shows the track, artist, artwork and
  elapsed time.
- **Media controls polish:** full MPRIS (Linux) and SMTC (Windows) beyond Electron's built-in
  `mediaSession`.

**Overlay editor:** in progress; the stages are in §8 (Editor roadmap).

**Other:**
- **Autoplay blocklist:** block artists, songs or albums from autoplay (and Start radio), separate
  from stream-safe. Blocked songs still show in search and can be queued by hand. Needs a page to
  view and edit the blocks, and probably a right-click "Don't autoplay this artist/song/album".
- **Analysis details:** a page listing the songs analysed and their measurements (tempo, key,
  energy, loudness, failures), linked from "X of Y analyzed" in Settings → Audio analysis.
- **History tags past three:** the tag column (§3, History) fits three. A fourth would show the
  third as "…", with the rest on hover. Not needed until a song can carry more than three.
- **Pause note (idea):** an optional short status for a pause ("Be right back", "Q&A"), set from
  the app or a bot, shown on the overlay in place of the pause sign or beside it. Not decided.
- Twitch chat song requests (`!sr <link|query>`): built on a `queue:add`-scoped token, with
  per-user limits, mod approval, vote-to-skip, and stream-safe enforcement.
- More providers: SoundCloud, Bandcamp, Subsonic/Navidrome, Tidal, Deezer.
- A web remote UI served by the API.
- EQ, compressor and visualizer, as inserts in the existing audio graph.
