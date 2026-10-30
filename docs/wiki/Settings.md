Open **Settings** in the top bar. Changes apply straight away; there's nothing to save.

## Playback

| Setting                                     | What it does                                                                                                                                                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Stream-safe mode**                        | Only songs tagged stream-safe can be queued and played. See [Stream-safe mode](Stream-safe-mode).                                                                                                    |
| **Output device**                           | Where the music plays. Pick a virtual cable or PipeWire sink for OBS to capture, or keep the system default. A device that's been unplugged shows as **Disconnected device** until you pick another. |
| **Crossfade**                               | Blends each song into the next, up to 12 seconds. At 0, songs play back to back with no gap.                                                                                                         |
| **Play tracks from the same album gapless** | With crossfade on, songs from the same album still run straight into each other, as live albums and mixes are meant to.                                                                              |

## Autoplay

Keeps the queue going with similar songs. See [Autoplay and radio](Autoplay-and-radio) for how it
picks.

| Setting                                       | What it does                                                    |
| --------------------------------------------- | --------------------------------------------------------------- |
| **Add similar songs when the queue runs low** | Autoplay on or off; the same as the switch on the queue.        |
| **Keep queued**                               | Songs are added while the queue is shorter than this (1 to 50). |
| **Draw from**                                 | **Library and YouTube Music**, or **Library only**.             |
| **Adventurousness**                           | **Closest match** at one end, **Wide** at the other.            |
| **Artist gap**                                | How many songs before an artist can play again (0 to 20).       |
| **Skip recent**                               | How many hours before a song can be picked again (0 to 168).    |

## Audio analysis

| Setting                                                                | What it does                                                                                    |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Analyze songs so autoplay can pick by tempo, key, energy and sound** | On by default. Shows how many songs are analyzed.                                               |
| **Keep analyzing while music plays**                                   | Off by default, because analysis keeps a CPU core busy, which could make a live stream stutter. |

## YouTube Music

**Sign in…** or **Sign out**, and **Use as** to choose which of your channels to play as. See
[YouTube Music](YouTube-Music).

## Library folders

The folders scanned for music, with **Add folder…**, **Rescan** and **Re-read all tags**. See
[Library](Library#music-folders).

## OBS overlays

Every overlay, each with **Copy URL** and the size to set its Browser Source to, and **New URLs…**
to replace every overlay's URL if one leaks. Overlays are made and designed in the **Overlays**
view. See [OBS overlays](OBS-overlays).

## API

The API's address, links to its interactive docs and OpenAPI document, and your tokens: create
them with a name, scopes and an optional rate limit, and revoke them. See
[Bots and the API](Bots-and-the-API).
