# Stream-safe mode

Stream-safe mode makes sure only songs you've cleared for your stream can play: songs you know
won't get a copyright strike, say, or that suit your audience.

## Tagging songs

Tag songs in your [library](Library):

- Press the stream-safe button on a library song in search, or right-click it, **Mark
  stream-safe**.
- To tag many at once, search for them, then use **Mark all stream-safe** above the results.

Tagging a YouTube Music song saves it to your library too.

## Turning it on

Turn on **Stream-safe mode** in [Settings → Playback](Settings#playback). A **Stream-safe** badge
shows in the status bar while it's on.

While it's on:

- Songs that aren't tagged can't be queued, by you or by a bot. A bot gets a
  `stream_safe_violation` error, so it can tell the viewer.
- Untagged songs already in the queue are marked **will be skipped**, and are skipped when their
  turn comes. Turning the mode on skips an untagged song that's playing.
- Adding an album or playlist adds only its tagged songs, and says how many were left out.
- [Autoplay](Autoplay-and-radio) picks only tagged songs, which in practice means songs from your
  library.

A YouTube Music song requested from chat that you also own as a file counts as your file, so it
carries your file's stream-safe tag.
