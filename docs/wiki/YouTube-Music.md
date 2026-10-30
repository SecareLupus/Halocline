# YouTube Music

Halocline searches YouTube Music without an account. Sign in to play songs with your own account,
so YouTube Music Premium applies.

## Signing in

In **Settings → YouTube Music**, press **Sign in…** and sign in to Google in the window that
opens. **Sign out** forgets the account.

If your Google account manages more than one YouTube channel (brand channels, or a family's
children's profiles), **Use as** picks which one Halocline plays as.

## How playback works

Halocline has two ways to play a YouTube Music song, and switches between them by itself:

- **Direct** (the usual way): Halocline fetches the song's audio itself. No ads apply.
- **Fallback:** a hidden YouTube Music page plays the song, for when the direct way breaks (YouTube
  changes things from time to time). Without Premium, this page may play ads. Halocline notices
  ads: they're never shown as the song, in the queue, the overlay or the API.

If direct streaming fails three times in a row, Halocline uses the fallback for 30 minutes before
trying direct again, so you don't wait for a failure on every song.

The song playing shows where it's playing from:

| Badge      | Meaning                                           |
| ---------- | ------------------------------------------------- |
| `local`    | your own file                                     |
| `cache`    | a YouTube Music song Halocline already downloaded |
| `direct`   | streamed from YouTube Music                       |
| `fallback` | played by the hidden YouTube Music page           |

The dot in the status bar sums it up: **green** when direct streaming works, **amber** when the
fallback was used recently, and **red** when direct streaming keeps failing. Point at it for
details; red usually means a Halocline update is needed.

## Starting fast

While a song plays, Halocline downloads the next YouTube Music song in the queue, so it starts
without a delay. These downloads are kept in a 1 GB cache, which is also what
[audio analysis](Autoplay-and-radio#audio-analysis) uses for YouTube Music songs.

The first song after a while can take several seconds to start: YouTube asks new connections to
wait.
