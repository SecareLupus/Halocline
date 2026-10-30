## Playback

**YouTube Music songs are skipped.** Look in Settings → YouTube Music. If it says no playback engine
is available, YouTube Music songs can be found and queued, but not played.

**The status dot is red.** Direct streaming from YouTube Music keeps failing, usually because
YouTube changed something. Songs still play, through the fallback (see
[YouTube Music](YouTube-Music#how-playback-works)), but check for a Halocline update. Point at the
dot to see the last error.

**A YouTube Music song takes a few seconds to start.** The first song after a while waits on
YouTube; songs after it are downloaded ahead and start straight away.

**No sound, or sound in the wrong place.** Check **Output device** in Settings → Playback. If it
says **Disconnected device**, the device you picked isn't there now: plug it back in, or pick
another.

**A song I've tagged doesn't play in stream-safe mode.** Make sure the version queued is the one
you tagged: a song saved twice (say, two different uploads) is two songs. Merge them; see
[Fixing duplicates](Library#fixing-duplicates).

## Search and links

**A link queued the wrong song,** or the same song shows twice in my library. See
[Fixing duplicates](Library#fixing-duplicates): **Split off** separates two different songs that
were joined, and **Merge** joins duplicates.

**A link shows choices instead of playing.** Halocline wasn't sure which song it was. Pick the
right one.

## Autoplay

**Autoplay isn't adding songs.** Check it's switched on (top of the queue), that repeat is off, and
that the queue is shorter than **Keep queued**. In stream-safe mode it only picks tagged songs; with
few tagged, it may run out.

**Audio analysis isn't progressing.** It pauses while music plays, so it can't make your stream
stutter, and carries on when you pause or stop. To let it run during playback, turn on **Keep
analyzing while music plays** in Settings → Audio analysis.

## OBS

See [OBS overlays → Troubleshooting](OBS-overlays#troubleshooting).

## Bots and the API

**Settings → API says the API server isn't running.** Another program may be using its port
(17380). Close it and restart Halocline.

**A bot gets 401.** The token is missing, mistyped or revoked. Send it as
`Authorization: Bearer <token>`. (Only overlay URLs carry a token in the URL itself.)

**A bot gets 403.** The token doesn't have the scope that request needs: see the scopes table in
[Bots and the API](Bots-and-the-API#tokens). Make a new token with the right scopes.

## Starting over

To reset Halocline completely, close it and delete its data folder (see
[Where your data lives](Installing#where-your-data-lives)). That removes your library, settings,
overlays and tokens; your music files aren't touched.

Still stuck? Open an [issue](https://github.com/SecareLupus/Halocline/issues), saying what you did,
what you expected, and what happened.
