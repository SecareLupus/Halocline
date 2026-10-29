import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { Portal } from 'solid-js/web'

export type MenuItem =
  | { label: string; action: () => void; disabled?: boolean }
  /** A divider between groups of items. */
  | null

const [menu, setMenu] = createSignal<{ x: number; y: number; items: MenuItem[] } | null>(null)

/**
 * Right-click menu for a row: `onContextMenu={contextMenu(() => [...])}`. The
 * items are built when the menu opens, so they reflect the row as it is then.
 */
export function contextMenu(items: () => MenuItem[]) {
  return (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // A divider only between items: none doubled, or at either end.
    const list = items().filter((item, i, all) => item || (i > 0 && all[i - 1]))
    if (list.at(-1) === null) list.pop()
    setMenu({ x: e.clientX, y: e.clientY, items: list })
  }
}

/** The open menu, if any. Rendered once, by the app. */
export function ContextMenuHost() {
  return (
    <Show when={menu()} keyed>
      {(m) => <Menu {...m} />}
    </Show>
  )
}

function Menu(props: { x: number; y: number; items: MenuItem[] }) {
  let el: HTMLUListElement | undefined
  const close = () => setMenu(null)
  const buttons = () => [...el!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
  const step = (by: number) => {
    const all = buttons()
    const at = all.indexOf(document.activeElement as HTMLButtonElement)
    all[(at + by + all.length) % all.length]?.focus()
  }

  onMount(() => {
    // Opened near an edge, it flips to stay on screen.
    const menu = el!
    const { width, height } = menu.getBoundingClientRect()
    const x = props.x + width > innerWidth ? Math.max(0, props.x - width) : props.x
    const y = props.y + height > innerHeight ? Math.max(0, props.y - height) : props.y
    menu.style.left = `${x}px`
    menu.style.top = `${y}px`
    buttons()[0]?.focus({ preventScroll: true })

    const outside = (e: Event) => {
      if (!menu.contains(e.target as Node)) close()
    }
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowDown') step(1)
      else if (e.key === 'ArrowUp') step(-1)
      else return
      e.preventDefault()
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('scroll', close, true)
    document.addEventListener('keydown', keys, true)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    onCleanup(() => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('scroll', close, true)
      document.removeEventListener('keydown', keys, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    })
  })

  return (
    <Portal>
      <ul
        class="context-menu"
        role="menu"
        ref={(e) => (el = e)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <For each={props.items}>
          {(item) =>
            item ? (
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    close()
                    item.action()
                  }}
                >
                  {item.label}
                </button>
              </li>
            ) : (
              <li role="separator" />
            )
          }
        </For>
      </ul>
    </Portal>
  )
}
