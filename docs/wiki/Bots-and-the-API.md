# Bots and the API

Everything Halocline does can also be done over its HTTP API: queue a song a viewer asked for,
skip, pause, read what's playing, or follow along as things change. Stream bots, chat commands,
Stream Deck plugins and your own scripts can all use it.

The API runs while Halocline does, at `http://127.0.0.1:17380`. It only listens on your own
computer, so the bot has to run there too.

## Tokens

Every request needs a token. Make one in **Settings → API**:

1. Give it a name, such as "Chat bot".
2. Optionally, limit how many requests a minute it may make: 30 is plenty for a chat bot, and
   stops a flood of requests from a busy chat.
3. Tick the **scopes** it needs, and nothing more.
4. Press **Create token**, and copy the token straight away: it's shown only once.

Send it with each request as `Authorization: Bearer <token>`. **Revoke** a token in the same list
when it's no longer needed, or if it leaks.

| Scope            | Lets a token                                                             |
| ---------------- | ------------------------------------------------------------------------ |
| `read`           | see what's playing, the queue, the library, search, history and settings |
| `player:control` | play, pause, seek, skip, go back, and change volume, shuffle and repeat  |
| `queue:add`      | add songs to the queue (song requests)                                   |
| `queue:manage`   | add, move and remove queued songs, clear the queue, and Start radio      |
| `library:write`  | save songs, tag them stream-safe, merge and split, and rescan folders    |
| `admin`          | everything, including settings and overlays                              |
| `overlay`        | read what's playing, for OBS overlays only; their URLs carry one         |

A chat song-request bot needs only `queue:add`.

## Interactive docs

Open `http://127.0.0.1:17380/docs` (also linked from Settings → API) for every endpoint, with what
it takes and returns. Press **Authorize** and paste a token to try requests out. The OpenAPI
document is at `http://127.0.0.1:17380/openapi.json`, for generating a client.

## Examples

### Queue a song a viewer requested

Send whatever the viewer typed: a song link, a search, or a Halocline song id.

```bash
curl -X POST http://127.0.0.1:17380/v1/queue/items \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"input": "https://open.spotify.com/track/…", "requestedBy": "viewer_name"}'
```

- `requestedBy` is shown in [History](Playing-music#history) and can be shown on your
  [overlay](OBS-overlays#text-fields) with `{requester}`.
- Add `"position": "next"` to play it after the current song instead of at the end.
- **201:** queued. The reply is the queue item, with the song's title and artists to tell the
  viewer.
- **409 `stream_safe_violation`:** [stream-safe mode](Stream-safe-mode) is on and the song isn't
  tagged.
- **422 `match_ambiguous`:** Halocline isn't sure which song was meant. The reply lists
  `candidates`, each with an `input` to send back to queue it: your bot could show the viewer the
  choices.

Album and playlist links go to `POST /v1/queue/collections` instead.

### Control playback

```bash
# Skip to the next song
curl -X POST http://127.0.0.1:17380/v1/player/next -H "Authorization: Bearer $TOKEN"

# Pause (or {"playing": true} to play)
curl -X PATCH http://127.0.0.1:17380/v1/player \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"playing": false}'
```

`PATCH /v1/player` also takes `volume` (0 to 1), `positionMs`, `shuffle` and `repeat` (`off`,
`all` or `one`).

### What's playing

```bash
curl http://127.0.0.1:17380/v1/player -H "Authorization: Bearer $TOKEN"
```

The reply has the song (`current`), whether it's playing, the position, who requested it
(`current.requestedBy`), and the song after it (`next`).

## Following changes live

`GET /v1/events` is a stream of
[Server-Sent Events](https://developer.mozilla.org/docs/Web/API/Server-sent_events), so a bot can
react the moment something changes instead of asking over and over. The main events:

| Event                                | When                                                               |
| ------------------------------------ | ------------------------------------------------------------------ |
| `track.changed`                      | a new song starts; the data is the whole player state              |
| `player.changed`                     | play, pause, seek, volume, shuffle, repeat, or what's next changes |
| `queue.changed`                      | the queue changes                                                  |
| `library.changed`                    | songs are added or changed                                         |
| `settings.changed`                   | a setting changes                                                  |
| `health.changed`                     | YouTube Music playback health changes                              |
| `overlay.changed`, `overlay.deleted` | an overlay is edited, made or deleted                              |

If the connection drops, reconnecting with the last event's id (the `Last-Event-ID` header, which
`EventSource` sends by itself) replays what was missed.

## Errors and limits

Errors come back as `application/problem+json`, with a `type` your bot can check, such as
`stream_safe_violation`, `match_ambiguous`, `not_found` or `rate_limited`, and a `detail` to read.

A token over its rate limit gets **429**, with a `Retry-After` header saying how many seconds to
wait. For a token with a limit, `RateLimit-*` headers on every reply show how much is left.

## Browser-based bots

The API accepts requests from web pages, so browser-based tools such as Twitchat can call it
directly. That's safe: a page can only use a token it was given.

## Overlays over the API

Overlays can be listed, made, edited and deleted under `/v1/overlays` (`admin`), and images
uploaded with `POST /v1/overlays/images`. Edits carry a revision, sent back as `If-Match`, so two
editors can't overwrite each other's changes. The interactive docs have the details.
