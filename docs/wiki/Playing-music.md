# Playing music

The main window has search on one side and the queue on the other, with the player bar along the
bottom. Drag the line between search and the queue to resize them; double-click it to centre it.
In a narrow window, search sits above the queue.

## Search

Type in the search box to search your library and YouTube Music at once. Your library's results
come first, then YouTube Music songs, then YouTube Music albums and playlists.

Each song has buttons when you point at it:

- **Add** puts it on the end of the queue.
- **Next** puts it at the front, to play after the current song.
- **Save** adds a YouTube Music song to your [library](Library).

Right-click any song for more: **Play next**, **Add to queue**, **Save to library**,
**[Start radio](Autoplay-and-radio#start-radio)**, and for library songs, stream-safe tagging,
merging and splitting.

Albums and playlists open to show their tracks, with **Add all to queue**. Playlists are cut at
500 songs.

## Pasting a link

Paste a song link into the search box instead of typing. Halocline understands links from:

- YouTube and YouTube Music (a music video is swapped for its audio-only song where one exists)
- Spotify
- Apple Music
- Tidal
- Deezer

It reads the song's details from the link, then finds the same song: your own copy first, then
YouTube Music. You'll see what the link was read as, the best match, and the alternatives, each
with a score for how sure the match is. Pick one to queue it. Halocline never plays a doubtful
match on its own: if no match is confident, it shows the choices instead.

YouTube Music album and playlist links work too, and open like albums and playlists in search.

## The queue

The queue lists what's coming up. Drag songs to reorder them. Point at a song to remove it, or
right-click for **Play next** and **Remove from queue**.

- **Play from:** a song you have both as a file and on YouTube Music has a menu to choose where it
  plays from. **Auto** prefers your file.
- **Will be skipped:** with [stream-safe mode](Stream-safe-mode) on, songs that aren't tagged
  stream-safe are marked, and skipped when their turn comes.
- **Autoplay:** the switch at the top of the queue keeps it going with similar songs when it runs
  low. See [Autoplay and radio](Autoplay-and-radio).

## The player bar

The player bar shows the song playing, with previous, play/pause, next, a seek bar, shuffle,
repeat and volume.

- **Previous** restarts the song if it's more than 3 seconds in; otherwise it goes back to the
  song before.
- **Shuffle** plays a random song from the queue next.
- **Repeat** cycles between off, all and one:
  - **All** puts each song back on the end of the queue when it's done, so the queue goes round.
    Autoplay adds nothing while repeat is on.
  - **One** plays the current song again.
- Each song has a small badge showing where it's playing from: `local`, `cache`, `direct` or
  `fallback`. See [YouTube Music](YouTube-Music#how-playback-works).

Click the album art to open the **player view**: big art, the controls and the queue. Press
Escape, or the ⌄ in its corner, to go back.

## History

**History**, in the top bar, lists what you've played, newest first and grouped by day. Each entry
shows how the song got there: queued by you, by a bot (with the requester's name), or by autoplay.
You can queue songs again from it, save them, or start a radio from them.

**Clear history** empties the list. Play counts are kept, because autoplay uses them.

## Sound

In [Settings → Playback](Settings#playback):

- **Output device:** play to a particular device, such as a virtual audio cable or PipeWire sink
  that OBS captures, instead of the system default.
- **Crossfade:** blend from one song into the next, up to 12 seconds. With it at 0, songs play
  back to back with no gap.
- **Play tracks from the same album gapless:** albums meant to run together (live albums, DJ
  mixes) aren't crossfaded, even with crossfade on.
