/**
 * The renderer's own rules (PLAN §8). Each element's rule sets the custom
 * properties these read. Selectors stay at one class or attribute at most
 * (`:where()` adds nothing), so OBS Custom CSS, added later, wins.
 */
export const BASE_CSS = `
:where(.hl-overlay) {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  transition: opacity var(--hl-fade) ease;
}
:where(.hl-overlay.hl-hidden) {
  opacity: 0;
}
:where(.hl-overlay) .hl-canvas {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
}
:where(.hl-overlay) .hl-el {
  position: absolute;
  box-sizing: border-box;
  transition: opacity var(--hl-fade) ease;
}
/* An element whose showWhen rule doesn't hold right now. */
:where(.hl-overlay) .hl-el.hl-off {
  opacity: 0;
}
/* Art and text keep two copies, and cross-fade between them on a track change. */
:where(.hl-overlay) .hl-slot {
  position: absolute;
  inset: 0;
  opacity: 0;
  transition:
    opacity var(--hl-fade) ease,
    box-shadow var(--hl-fade) ease;
}
:where(.hl-overlay) .hl-slot.hl-active {
  opacity: 1;
}

:where(.hl-overlay) [data-type='rect'] {
  background: var(--hl-fill);
  border-radius: var(--hl-radius);
  border: var(--hl-border-width) solid var(--hl-border-color);
}

/* The border sits inside the box, and the radius clips the art within it. */
:where(.hl-overlay) [data-type='art'] {
  border-radius: var(--hl-radius);
  border: var(--hl-border-width) solid var(--hl-border-color);
  overflow: hidden;
}
:where(.hl-overlay) [data-type='art'] .hl-slot {
  background-color: var(--hl-placeholder);
  background-size: cover;
  background-position: center;
}
/* An inset shadow paints over the background image: the art darkens but stays opaque. */
:where(.hl-overlay.hl-paused) [data-type='art'] .hl-slot {
  box-shadow: inset 0 0 0 100vmax var(--hl-shade);
}
:where(.hl-overlay) [data-type='art']::after {
  content: '';
  position: absolute;
  inset: 30% 32%;
  background: linear-gradient(
    to right,
    var(--hl-sign) 0 35%,
    transparent 35% 65%,
    var(--hl-sign) 65%
  );
  filter: drop-shadow(0 1px 3px rgb(0 0 0 / 0.6));
  opacity: 0;
  transition: opacity var(--hl-fade) ease;
}
:where(.hl-overlay.hl-paused) [data-type='art']::after {
  opacity: var(--hl-sign-opacity);
}

:where(.hl-overlay) [data-type='image'] {
  background-repeat: no-repeat;
  background-position: center;
  background-origin: padding-box;
  border-radius: var(--hl-radius);
  border: var(--hl-border-width) solid var(--hl-border-color);
}

/* Image masks stretch over the element, so a mask drawn for one size fits any. */
:where(.hl-overlay) .hl-el {
  mask-size: 100% 100%;
  -webkit-mask-size: 100% 100%;
  mask-repeat: no-repeat;
  -webkit-mask-repeat: no-repeat;
}

:where(.hl-overlay) [data-type='text'] {
  font-family: var(--hl-font);
  font-weight: var(--hl-weight);
  color: var(--hl-color);
  text-align: var(--hl-align);
  text-shadow: var(--hl-shadow);
  line-height: 1.2;
}
:where(.hl-overlay) [data-type='text'] .hl-slot {
  display: flex;
  align-items: center;
}
/* --hl-fit is set by the script: below 1 when the line is too long at full size. */
:where(.hl-overlay) .hl-line {
  width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: calc(var(--hl-size) * var(--hl-fit, 1));
}

:where(.hl-overlay) [data-type='progress'] {
  background: var(--hl-track);
  box-shadow: inset 0 0 0 1px var(--hl-edge);
  border-radius: var(--hl-radius);
  overflow: hidden;
}
:where(.hl-overlay) .hl-fill {
  height: 100%;
  width: 0;
  background: var(--hl-fill);
  transition: background-color var(--hl-fade) ease;
}
:where(.hl-overlay.hl-paused) .hl-fill {
  background: var(--hl-paused-fill);
}
`
