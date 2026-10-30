# OBS overlays

An overlay shows what's playing on your stream: album art, the artist and title, a progress bar,
who requested the song, what's next. It's a web page you add to OBS as a **Browser Source**. Its
background is see-through, so it sits over your scene.

You can have as many overlays as you like, each with its own design and its own URL: a full one
for your "Just chatting" scene and a slim one for gameplay, say. Halocline starts you off with one
called **Classic**.

## Adding an overlay to OBS

1. In Halocline, open **Settings → OBS overlays** (or the **Overlays** view) and press **Copy URL**
   beside the overlay you want. Halocline tells you the size to use, such as 375×140.
2. In OBS, add a **Browser** source to your scene, and paste the URL into its **URL** field.
3. Set its **Width** and **Height** to the overlay's size. This gives you a 1:1 picture; at any
   other size the overlay is scaled to fit, keeping its shape.
4. Move it where you want it in your scene.

The overlay shows while a song is playing, and fades out when nothing is playing, during an ad,
and after five minutes paused (you can change that). While paused, it greys the progress bar and
shows a pause sign over the art.

Halocline must be running for the overlay to work, and OBS must be on the same computer.

The URL contains a key that lets OBS read what's playing, and nothing else. If one leaks (say it
was visible on stream), press **New URLs…** in Settings: every overlay gets a new URL, the old ones
stop working, and you paste the new ones into your Browser Sources.

## The Overlays view

Open **Overlays** in the top bar to make and design overlays. On the left is the list of your
overlays; the selected one fills the rest of the window.

- **New overlay** makes one from a template:
  - **Classic:** art and two lines of text on a dark panel, with the progress bar along the bottom.
  - **Pill:** a slim rounded bar with round art, for a screen edge.
  - **Card:** large art with the song under it, for a corner of a camera scene.
  - **Lower third:** just the song, in large shadowed text over the scene, and a thin bar.
- The toolbar renames the overlay, has **Undo** and **Redo**, **Copy OBS URL**, **Export…**, and
  **Delete** (click it twice). You can delete any overlay, Classic included.

Every change saves by itself a moment after you make it, and any OBS source showing that overlay
redraws straight away, so you can design with OBS open and watch the result on your scene.

### The preview

The preview draws the overlay exactly as OBS will, over a checkerboard so you can see what's
see-through. Above it, choose what it shows:

- **Playing**, **Paused**, **Long names** and **No art** are made-up songs, to check your design
  copes with each case. Some come with a requester and a next song, so you can try those too.
- **Live** shows what's really playing in Halocline. With nothing playing it's blank, just as OBS
  would be.

### Moving and resizing

Work on the overlay right in the preview:

- **Click** an element to select it. **Shift-click** (or Ctrl-click) adds to or removes from the
  selection, and dragging a box from an empty spot selects everything it touches. There's a margin
  around the canvas to start a box from.
- **Drag** to move the selection. Pull a **handle** to resize a single element; hold **Shift** on a
  corner to keep its shape.
- Edges and centres **snap** to the canvas's edges and centre and to other elements, and a dashed
  line shows what lined up. Hold **Alt** to move freely.
- **Keys:** arrows nudge by 1 pixel (Shift: 10), Delete removes, Escape deselects, Ctrl+A selects
  everything, Ctrl+Z undoes, and Ctrl+Shift+Z or Ctrl+Y redoes.

### Properties

Below the preview:

- **Overlay:** the canvas size, how long fades take, and whether it hides after being paused a
  while (and after how many minutes).
- **Elements:** everything in the overlay, front first. Use ↑ and ↓ to bring an element forward or
  send it back, ✕ to remove it, and **Add** to add one.
- The selected element: its id, position, size and opacity, when it shows, and its own settings.
  Colours have a picker and an opacity slider, beside the colour written out, where you can also
  type any CSS colour or gradient.

## Elements

| Element          | What it is                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Panel**        | A coloured or gradient shape, usually behind the others.                                                                                                      |
| **Album art**    | The playing song's cover, cross-fading when the song changes. Its "No art" colour shows when a song has none; while paused it darkens and shows a pause sign. |
| **Text**         | One line of text, filled in from the song (see below). Too long for its box, it shrinks a little, then ends with "…".                                         |
| **Progress bar** | How far through the song you are, with separate colours for played, paused and the rest.                                                                      |
| **Image**        | A picture of your own, such as a logo or a frame.                                                                                                             |

### Text fields

Write a text element's **Text** with any mix of your own words and these fields:

| Field              | Becomes                                             |
| ------------------ | --------------------------------------------------- |
| `{title}`          | the song's title                                    |
| `{artists}`        | its artists, separated by commas                    |
| `{album}`          | its album                                           |
| `{requester}`      | who requested it, when a bot queued it for a viewer |
| `{next.title}`     | the title of the song after it                      |
| `{next.artists}`   | that song's artists                                 |
| `{next.album}`     | that song's album                                   |
| `{next.requester}` | who requested that song                             |

For example, `Requested by {requester}`, or `Up next: {next.artists} — {next.title}`. A field with
nothing to show is left empty. Pick fonts from the list (your installed fonts appear there) or type
any font name.

### When an element shows

Each element's **Show** setting decides when it's visible. It fades in and out, like the overlay.

| Show                            | Visible                                                     |
| ------------------------------- | ----------------------------------------------------------- |
| Always                          | whenever the overlay is                                     |
| While playing                   | not while paused                                            |
| While paused                    | only while paused: a "Be right back" message, say           |
| When someone requested the song | only for requested songs: a "Requested by {requester}" line |
| When nobody requested it        | only for songs nobody requested                             |
| When there's a next song        | only when something is queued: an "Up next" line            |

### Shapes, corners and borders

Panels, album art and images can be shaped:

- **Corners** rounds them. Tick **Round** for fully round, which makes square art a circle and
  anything longer a pill, at any size. Progress bars can be rounded too.
- **Border** draws a border inside the edge, in any colour: a ring around round art, say. Borders
  are for box shapes only.
- **Shape** crops to a hexagon, octagon, diamond, triangle or star.

### Images and masks

Image elements, and masks, use pictures of your own: PNG, JPEG, WebP or GIF, up to 10 MB each.

- On an image element, press **Choose…** and pick a file. **Fit** decides how it fills its box:
  **Fit the whole image**, **Fill the box, cropping**, or **Stretch to the box**.
- A **Mask** crops a panel, art or image to the shape of another picture: the picture's opaque
  parts show the element, and its see-through parts hide it. Soft edges in the picture give soft
  edges on stream. Masks stretch to fit the element, so one mask works at any size.

## Import and export

**Export…** saves the overlay to a file, with the images it uses inside, to back it up or share it.
**Import…**, under the list of overlays, makes a new overlay from such a file. Files are checked
when they're imported, so a broken or unfamiliar one is refused with a reason, and can't affect
your stream.

## Restyling from OBS

OBS's Browser Source has a **Custom CSS** box, and its rules apply over Halocline's. Every element
has the class `hl-` plus its id, which you see and can change in its properties. For Classic, those
are `.hl-panel`, `.hl-art`, `.hl-artist`, `.hl-title` and `.hl-bar`. For example:

```css
.hl-title {
  color: gold;
}
```

The editor is usually easier, but Custom CSS is handy for a tweak to one scene only.

## Troubleshooting

- **The overlay is blank in OBS.** Is a song playing in Halocline? The overlay hides when nothing
  is, during ads, and after five minutes paused. Check the URL was pasted whole, and that
  Halocline is running.
- **It stopped working after I pressed New URLs….** Every overlay's URL changed: copy each one
  again and paste it into its Browser Source.
- **It looks small, large or cut off.** Set the Browser Source's width and height to the size
  shown when you copied the URL.
- **A "not found" error.** That overlay was deleted. Copy the URL of another one.
- **Upgrading from 0.1:** your overlay carries on at the same URL, as an editable overlay named
  Classic. It now keeps a fixed size and scales instead of stretching, and the
  old Custom CSS variables such as `--hl-bar-color` no longer work: change those colours in the
  editor instead.
