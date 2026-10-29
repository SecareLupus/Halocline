import { createSignal } from 'solid-js'

const MIN = 0.15
const MAX = 0.85
const clamp = (n: number) => Math.min(MAX, Math.max(MIN, n))

/** A split remembered per layout (side by side, or stacked). */
export function createSplit(key: string) {
  const stored = (() => {
    try {
      return Number(localStorage.getItem(key))
    } catch {
      return NaN
    }
  })()
  const [ratio, setRatio] = createSignal(stored > 0 ? clamp(stored) : 0.5)
  const set = (n: number) => {
    setRatio(clamp(n))
    try {
      localStorage.setItem(key, String(ratio()))
    } catch {
      // Not remembered; the split still works.
    }
  }
  return [ratio, set] as const
}

/**
 * The handle between two panes. Dragging moves it; arrow keys nudge it; a
 * double-click puts it back in the middle.
 */
export function Splitter(props: {
  vertical: boolean
  ratio: number
  onChange: (ratio: number) => void
}) {
  const move = (e: PointerEvent & { currentTarget: HTMLElement }) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const box = e.currentTarget.parentElement!.getBoundingClientRect()
    props.onChange(
      props.vertical ? (e.clientY - box.top) / box.height : (e.clientX - box.left) / box.width,
    )
  }
  return (
    <div
      class="splitter"
      classList={{ vertical: props.vertical }}
      role="separator"
      tabIndex={0}
      aria-orientation={props.vertical ? 'horizontal' : 'vertical'}
      aria-valuemin={MIN * 100}
      aria-valuemax={MAX * 100}
      aria-valuenow={Math.round(props.ratio * 100)}
      aria-label="Resize panes"
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={move}
      onDblClick={() => props.onChange(0.5)}
      onKeyDown={(e) => {
        const back = props.vertical ? 'ArrowUp' : 'ArrowLeft'
        const forward = props.vertical ? 'ArrowDown' : 'ArrowRight'
        if (e.key === back) props.onChange(props.ratio - 0.02)
        else if (e.key === forward) props.onChange(props.ratio + 0.02)
        else return
        e.preventDefault()
      }}
    />
  )
}
