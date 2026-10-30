Your library is your music files plus any [cloud songs](Cloud-music) you've saved. Library songs
come first in search, can be tagged [stream-safe](Stream-safe-mode), and are what autoplay draws on
first.

## Music folders

In **Settings → Library folders**:

- **Add folder…** adds a folder of music. It's scanned straight away, and watched from then on,
  so files you add, change or delete show up by themselves.
- **Rescan** looks for new and changed files.
- **Re-read all tags** reads every file's tags again, not just new or changed ones: useful after
  retagging a lot of files in another program.
- Removing a folder makes its songs unavailable. Their tags and stream-safe flags are kept, in
  case you add the folder back.

The first scan of a big folder takes a while; progress shows in the status bar along the bottom.
Cover art embedded in your files is used everywhere a song shows, including the OBS overlay.

## Saving cloud music

Press **Save** on a cloud song (or right-click it, **Save to library**) to add it to your library
without downloading it. Saved songs that have no local file show a cloud badge. Tagging a
song stream-safe also saves it.

If you have the same song as a file and in the cloud, Halocline treats them as one song with two
places to play from, and plays your file. It matches them by ISRC when both have one, and
otherwise by title, artist and length (within 3 seconds). Version notes like "Remastered 2011" are
ignored when matching, but "Live" and "Radio Edit" count, so a live version is never taken for the
studio one.

## Fixing duplicates

Halocline only joins two songs when it's sure. When it misses, you get a duplicate; when the
details are wrong, it can join two different songs. Both are fixed from a library song's
right-click menu.

- **Merge a duplicate into this…** keeps this song and folds another into it. Find the duplicate
  (search for it if needed) and press its **Merge** button. Everything moves over: where it can
  play from, its audio analysis, tags and play counts. It stays saved and stream-safe if either
  copy was. Songs already queued keep working.
- **Split off: …** moves one place a song plays from (a file, or a cloud service) onto a new song of
  its own, for when two different songs were joined. The new song has to be tagged stream-safe
  again: it might be a different song.
