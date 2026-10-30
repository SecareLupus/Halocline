import type { OverlayDocument, OverlayElement } from '@halocline/core/overlay'
import {
  canvasScale,
  fitScale,
  formatText,
  isPaused,
  isShown,
  progress,
  showsFor,
  trackKey,
  type OverlayState,
} from './state'
import { BASE_CSS } from './styles'

export interface MountOptions {
  /** Turns `Recording.artwork` into an image URL. By default only https URLs show. */
  artworkUrl?: (artwork: string) => string | null
  now?: () => number
}

export interface OverlayView {
  /** Redraws with another document, keeping the song shown. */
  setDocument(doc: OverlayDocument): void
  setState(state: OverlayState | null): void
  destroy(): void
}

/** An element as drawn, with the two copies that cross-fade between songs (art and text). */
interface Drawn {
  element: OverlayElement
  node: HTMLElement
  slots: HTMLElement[]
  fill: HTMLElement | null
}

let mounts = 0

/**
 * Draws an overlay document into `root` (PLAN §8), scaled to fit it. The same
 * renderer runs in OBS and in the editor's preview, so the two can't drift.
 */
export function mountOverlay(
  root: HTMLElement,
  doc: OverlayDocument,
  options: MountOptions = {},
): OverlayView {
  const now = options.now ?? Date.now
  const artworkUrl =
    options.artworkUrl ?? ((artwork: string) => (artwork.startsWith('https://') ? artwork : null))
  const page = root.ownerDocument
  const mount = String(++mounts)
  const scope = `:where(.hl-overlay[data-hl-mount="${mount}"])`
  const styles = mountStyles(page)
  root.classList.add('hl-overlay', 'hl-hidden')
  root.dataset.hlMount = mount
  const canvas = page.createElement('div')
  canvas.className = 'hl-canvas'
  root.append(canvas)

  let current = doc
  let drawn: Drawn[] = []
  let state: OverlayState | null = null
  let shownKey: string | null = null
  let active = 0
  let frame = 0

  function rule(selector: string, properties: Record<string, string>) {
    const sheet = styles.sheet!
    const index = sheet.insertRule(`${selector} {}`, sheet.cssRules.length)
    const style = (sheet.cssRules[index] as CSSStyleRule).style
    // Set one by one through the CSSOM: an invalid value is dropped, never parsed as CSS text.
    for (const [name, value] of Object.entries(properties)) style.setProperty(name, value)
  }

  function build() {
    const sheet = styles.sheet!
    while (sheet.cssRules.length) sheet.deleteRule(0)
    rule(scope, { '--hl-fade': `${current.fadeMs}ms` })
    canvas.style.width = px(current.canvas.width)
    canvas.style.height = px(current.canvas.height)
    canvas.replaceChildren()
    drawn = current.elements.map((element) => {
      rule(`${scope} .hl-${CSS.escape(element.id)}`, elementStyle(element))
      const node = page.createElement('div')
      node.className = `hl-el hl-${element.id}`
      node.dataset.type = element.type
      // The editor maps a click in its preview back to the element.
      node.dataset.id = element.id
      canvas.append(node)
      const slots: HTMLElement[] = []
      if (element.type === 'art' || element.type === 'text') {
        for (let i = 0; i < 2; i++) {
          const slot = page.createElement('div')
          slot.className = 'hl-slot'
          if (element.type === 'text') slot.append(withClass(page.createElement('div'), 'hl-line'))
          node.append(slot)
          slots.push(slot)
        }
      }
      const fill =
        element.type === 'progress'
          ? node.appendChild(withClass(page.createElement('div'), 'hl-fill'))
          : null
      return { element, node, slots, fill }
    })
    active = 0
    rescale()
    if (state?.current) showTrack(state, false)
  }

  // Cross-fade: fill the hidden copies, then swap which ones are shown.
  function showTrack(shown: OverlayState, fade: boolean) {
    const track = shown.current!.recording
    const incoming = fade ? 1 - active : active
    for (const { element, slots } of drawn) {
      const slot = slots[incoming]
      if (!slot) continue
      if (element.type === 'art') {
        const url = track.artwork ? artworkUrl(track.artwork) : null
        slot.style.backgroundImage = url ? `url("${url.replace(/"/g, '%22')}")` : ''
      } else if (element.type === 'text') {
        setLine(slot, element.text, element.minScale, shown)
      }
      slots[active]?.classList.remove('hl-active')
      slot.classList.add('hl-active')
    }
    active = incoming
  }

  function setLine(slot: HTMLElement, template: string, minScale: number, shown: OverlayState) {
    const line = slot.firstElementChild as HTMLElement
    const text = formatText(template, shown)
    if (line.textContent === text) return
    line.textContent = text
    fit(line, minScale)
  }

  // The same song, but text can still change: up next follows the queue.
  function refreshText(shown: OverlayState) {
    for (const { element, slots } of drawn) {
      const slot = slots[active]
      if (element.type === 'text' && slot) setLine(slot, element.text, element.minScale, shown)
    }
  }

  // A line too long for its box shrinks until it fits, but no further than its
  // minScale; past that, the ellipsis cuts it off.
  function fit(line: HTMLElement, min: number) {
    line.style.setProperty('--hl-fit', '1')
    if (!line.textContent || line.clientWidth === 0) return
    line.style.setProperty('--hl-fit', String(fitScale(line.clientWidth, line.scrollWidth, min)))
  }

  function refit() {
    for (const { element, slots } of drawn) {
      if (element.type !== 'text') continue
      for (const slot of slots) fit(slot.firstElementChild as HTMLElement, element.minScale)
    }
  }

  function rescale() {
    const scale = canvasScale(
      { width: root.clientWidth, height: root.clientHeight },
      current.canvas,
    )
    canvas.style.transform = `scale(${scale})`
  }

  // Visibility and progress change with time, not only with events.
  function update() {
    const time = now()
    root.classList.toggle('hl-hidden', !isShown(state, current.hideAfterPausedMs, time))
    root.classList.toggle('hl-paused', isPaused(state))
    const ratio = progress(state, time)
    for (const { element, node, fill } of drawn) {
      if (fill) fill.style.width = ratio * 100 + '%'
      node.classList.toggle('hl-off', !showsFor(element.showWhen, state))
    }
  }

  function tick() {
    update()
    frame = requestAnimationFrame(tick)
  }

  // Sizes change with the source, and line widths once fonts have loaded.
  const resized = new ResizeObserver(() => {
    rescale()
    refit()
  })
  resized.observe(root)
  page.fonts.addEventListener('loadingdone', refit)
  void page.fonts.ready.then(refit)

  build()
  tick()

  return {
    setDocument(next) {
      current = next
      build()
      update()
    },
    setState(next) {
      state = next
      const key = trackKey(next)
      if (next?.current && key !== shownKey) {
        showTrack(next, shownKey !== null)
        shownKey = key
      } else if (next?.current) {
        refreshText(next)
      }
      update()
    },
    destroy() {
      cancelAnimationFrame(frame)
      resized.disconnect()
      page.fonts.removeEventListener('loadingdone', refit)
      styles.remove()
      canvas.remove()
      root.classList.remove('hl-overlay', 'hl-hidden', 'hl-paused')
      delete root.dataset.hlMount
    },
  }
}

const px = (n: number) => `${n}px`

function withClass(node: HTMLElement, className: string): HTMLElement {
  node.className = className
  return node
}

function elementStyle(element: OverlayElement): Record<string, string> {
  const box = {
    left: px(element.x),
    top: px(element.y),
    width: px(element.width),
    height: px(element.height),
    opacity: String(element.opacity),
  }
  switch (element.type) {
    case 'rect':
      return {
        ...box,
        '--hl-fill': element.fill,
        '--hl-radius': px(element.radius),
        '--hl-border-width': px(element.borderWidth),
        '--hl-border-color': element.borderColor,
      }
    case 'art':
      return {
        ...box,
        '--hl-placeholder': element.placeholder,
        '--hl-radius': px(element.radius),
        '--hl-border-width': px(element.borderWidth),
        '--hl-border-color': element.borderColor,
        '--hl-shade': element.pausedShade,
        '--hl-sign': element.pauseSign ?? 'transparent',
        '--hl-sign-opacity': element.pauseSign === null ? '0' : '1',
      }
    case 'text':
      return {
        ...box,
        '--hl-font': element.font,
        '--hl-size': px(element.size),
        '--hl-weight': String(element.weight),
        '--hl-color': element.color,
        '--hl-align': element.align,
        '--hl-shadow': element.shadow ?? 'none',
      }
    case 'progress':
      return {
        ...box,
        '--hl-fill': element.fill,
        '--hl-paused-fill': element.pausedFill,
        '--hl-track': element.track,
        '--hl-edge': element.edge ?? 'transparent',
        '--hl-radius': px(element.radius),
      }
  }
}

/**
 * The base rules once per page, then one sheet per mount. Both go first in
 * <head>, so OBS Custom CSS (appended on load) comes after them and wins.
 */
function mountStyles(page: Document): HTMLStyleElement {
  let base = page.head.querySelector<HTMLStyleElement>('style[data-hl-base]')
  if (!base) {
    base = page.createElement('style')
    base.dataset.hlBase = ''
    base.textContent = BASE_CSS
    page.head.prepend(base)
  }
  const own = page.createElement('style')
  base.after(own)
  return own
}
