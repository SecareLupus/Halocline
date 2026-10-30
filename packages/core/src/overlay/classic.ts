import { SYSTEM_FONT, type OverlayDocument } from './schema'

const shadow = '0 1px 3px rgb(0 0 0 / 0.6)'

/**
 * The built-in layout (PLAN §8): art and two lines of text on a dark panel, with
 * the progress bar along the bottom. Its ids match the old page's classes.
 *
 * The text lines are as tall as their line height (1.2 × size) and centred
 * together in the 130px above the bar: (130 − 21.6 − 27) / 2 = 40.7.
 */
export const CLASSIC_OVERLAY: OverlayDocument = {
  version: 1,
  canvas: { width: 375, height: 140 },
  fadeMs: 300,
  hideAfterPausedMs: 5 * 60_000,
  elements: [
    {
      type: 'rect',
      id: 'panel',
      x: 0,
      y: 0,
      width: 375,
      height: 130,
      opacity: 1,
      fill: 'rgb(0 0 0 / 0.7)',
      radius: 0,
      borderWidth: 0,
      borderColor: '#ffffff',
    },
    {
      type: 'art',
      id: 'art',
      x: 0,
      y: 0,
      width: 130,
      height: 130,
      opacity: 1,
      placeholder: 'rgb(255 255 255 / 0.15)',
      radius: 0,
      borderWidth: 0,
      borderColor: '#ffffff',
      pausedShade: 'rgb(0 0 0 / 0.55)',
      pauseSign: '#ffffff',
    },
    {
      type: 'text',
      id: 'artist',
      x: 146,
      y: 40.7,
      width: 213,
      height: 21.6,
      opacity: 0.85,
      text: '{artists}',
      font: SYSTEM_FONT,
      size: 18,
      weight: 400,
      color: '#ffffff',
      align: 'left',
      shadow,
      minScale: 0.75,
    },
    {
      type: 'text',
      id: 'title',
      x: 146,
      y: 62.3,
      width: 213,
      height: 27,
      opacity: 1,
      text: '{title}',
      font: SYSTEM_FONT,
      size: 22.5,
      weight: 600,
      color: '#ffffff',
      align: 'left',
      shadow,
      minScale: 0.75,
    },
    {
      type: 'progress',
      id: 'bar',
      x: 0,
      y: 130,
      width: 375,
      height: 10,
      opacity: 1,
      fill: '#5ccf9e',
      pausedFill: '#9aa3ad',
      track: 'rgb(0 0 0 / 0.5)',
      edge: 'rgb(255 255 255 / 0.25)',
      radius: 0,
    },
  ],
}
