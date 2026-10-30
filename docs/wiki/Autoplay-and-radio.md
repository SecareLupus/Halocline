## Autoplay

With autoplay on, Halocline adds songs similar to what's playing whenever the queue runs low, so
the music never stops. Turn it on or off with the **Autoplay** switch at the top of the queue, or in
[Settings → Autoplay](Settings#autoplay), which also has its options:

| Setting             | What it does                                                   | Default      |
| ------------------- | -------------------------------------------------------------- | ------------ |
| **Keep queued**     | Songs are added while the queue is shorter than this.          | 2 songs      |
| **Draw from**       | **Library and YouTube Music**, or **Library only**.            | Both         |
| **Adventurousness** | From **Closest match**, through **Some variety**, to **Wide**. | Some variety |
| **Artist gap**      | Songs before the same artist can play again.                   | 3            |
| **Skip recent**     | Hours before a song can be picked again.                       | 3 hours      |

How it picks:

- It starts from the last song in the queue (or the one playing, when the queue is empty).
- Candidates come from YouTube Music's own radio for that song, plus your library songs by the same
  or recent artists, or with the same tags, and, once they've been analyzed, songs that sound like
  it.
- They're ranked by how well they fit, and one is picked from the top few: the more adventurous,
  the wider the pick.
- It never picks another version (a remix, a cover) of a song that just played.
- If its rules leave nothing to pick, it relaxes the artist gap first, then the recent-song rule.

Autoplay adds nothing while repeat is on, since the queue is going round. In
[stream-safe mode](Stream-safe-mode) it picks only stream-safe songs.

Songs autoplay adds are marked as autoplay in [History](Playing-music#history).

## Start radio

Right-click a song in search or history and choose **Start radio** to send the music in a new
direction. The queue is replaced with that song, then filled with songs like it. The song playing
keeps playing. Start radio works whether autoplay is on or not.

## Audio analysis

Halocline listens to your music to judge how similar songs are: tempo, key, energy, loudness, and
an overall "sound" fingerprint. Autoplay then prefers songs that fit together, such as similar
tempos and keys that mix well.

- Local files are analyzed in the background. YouTube Music songs are analyzed once they've been
  played or downloaded ahead of playing.
- It takes around 8 seconds per song. Songs over 20 minutes are skipped.
- The first time, Halocline downloads the analysis model (78 MB).
- So it can't make a live stream stutter, analysis **pauses while music plays**, and carries on
  when it's paused or stopped. **Keep analyzing while music plays** lifts that, if your computer
  has cores to spare.

Turn it off, and see how far it's got, in [Settings → Audio analysis](Settings#audio-analysis).
Autoplay still works without it, from YouTube Music's radio and your library.
