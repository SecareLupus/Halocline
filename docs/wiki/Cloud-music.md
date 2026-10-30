Besides your own files, Halocline plays **cloud music**: songs streamed from a music service, which
you can search, queue and save without downloading them. **YouTube Music** is the service Halocline
supports today; more are planned.

## Searching and saving

Search covers your library and the cloud at once: your library's results come first, then cloud
songs, albums and playlists. You can paste a cloud song's link too. See
[Playing music](Playing-music#search).

Save a cloud song to keep it in your library beside your files; see
[Library](Library#saving-cloud-music). If you have the same song as a file, Halocline plays your
file.

## How cloud songs play

- While a song plays, Halocline downloads the next cloud song in the queue ahead of time, so it
  starts without a delay.
- These downloads are kept in a cache of up to 1 GB, so songs you've played recently start
  straight away and survive network blips.
- Cached songs are also what [audio analysis](Autoplay-and-radio#audio-analysis) uses for cloud
  music.
- The first song after a while can take several seconds to start, while the service sets up the
  connection.

## Where a song plays from

The song playing has a small badge showing where it's playing from:

| Badge      | Meaning                                                                |
| ---------- | ---------------------------------------------------------------------- |
| `local`    | your own file                                                          |
| `cache`    | a cloud song Halocline already downloaded                              |
| `direct`   | streamed by Halocline from YouTube Music                               |
| `fallback` | played by a hidden YouTube Music page (see [below](#two-ways-to-play)) |

A song you have both as a file and in the cloud can be told which to use: see **Play from** in
[the queue](Playing-music#the-queue).

## YouTube Music

### Signing in

Halocline searches YouTube Music without an account. Sign in to play songs as your own account, so
your YouTube Music Premium applies.

In **Settings → YouTube Music**, press **Sign in…** and sign in to Google in the window that opens.
**Sign out** forgets the account.

If your Google account manages more than one YouTube channel (brand channels, or a family's
children's profiles), **Use as** picks which one Halocline plays as.

### Two ways to play

Halocline has two ways to play a YouTube Music song, and switches between them by itself:

- **Direct** (the usual way): Halocline fetches the song's audio itself.
- **Fallback:** a hidden YouTube Music page plays the song, for when the direct way breaks (YouTube
  changes things from time to time). Without Premium, this page may play ads. Halocline notices
  them: they're never displayed as the song, in the queue, the overlay or the API.

If direct streaming fails three times in a row, Halocline uses the fallback for 30 minutes before
trying direct again, so you don't wait for a failure on every song.

### The status dot

The dot in the status bar sums up how YouTube Music playback is going: **green** when direct
streaming works, **amber** when the fallback was used recently, and **red** when direct streaming
keeps failing. Hover over it for details; red usually means a Halocline update is needed.
