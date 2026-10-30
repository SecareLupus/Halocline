import {
  OverlayElementId,
  SYSTEM_FONT,
  type OverlayDocument,
  type OverlayElement,
} from '@halocline/core/overlay'
import {
  addElement,
  ELEMENT_TYPES,
  moveElement,
  parseRgb,
  removeElement,
  rgbCss,
  updateElement,
  type ElementType,
} from '@halocline/overlay'
import { createSignal, For, Match, onMount, Show, Switch, type JSX } from 'solid-js'

const TYPE_LABEL = Object.fromEntries(ELEMENT_TYPES.map((t) => [t.type, t.label])) as Record<
  ElementType,
  string
>

const GENERIC_FONTS = [SYSTEM_FONT, 'system-ui', 'sans-serif', 'serif', 'monospace']

/** Installed font families, when Chromium will list them; generic families otherwise. */
const [fonts, setFonts] = createSignal<string[]>(GENERIC_FONTS)
let fontsAsked = false
function loadFonts() {
  if (fontsAsked) return
  fontsAsked = true
  const query = (window as { queryLocalFonts?: () => Promise<{ family: string }[]> })
    .queryLocalFonts
  void query?.()
    .then((list) => setFonts([...GENERIC_FONTS, ...new Set(list.map((f) => f.family))]))
    .catch(() => {})
}

/**
 * The browser's reading of a CSS colour, for the picker; null for anything else
 * (a gradient, say), which stays editable as text.
 */
function readColor(value: string): { hex: string; alpha: number } | null {
  const probe = document.createElement('span')
  probe.style.color = value
  if (!probe.style.color) return null
  document.body.append(probe)
  const computed = getComputedStyle(probe).color
  probe.remove()
  return parseRgb(computed)
}

/** The overlay's own settings, its elements, and the selected element's properties. */
export function OverlayProperties(props: {
  doc: OverlayDocument
  selected: string | null
  onSelect: (id: string | null) => void
  onChange: (doc: OverlayDocument) => void
}) {
  const [adding, setAdding] = createSignal<ElementType>('text')
  const element = () => props.doc.elements.find((e) => e.id === props.selected)
  const set = (changes: Partial<OverlayDocument>) => props.onChange({ ...props.doc, ...changes })
  const setElement = (changes: Partial<OverlayElement>) => {
    const id = props.selected
    if (!id) return
    props.onChange(updateElement(props.doc, id, changes))
    if (changes.id !== undefined) props.onSelect(changes.id)
  }
  onMount(loadFonts)
  // Ids are checked before they're applied: with two elements sharing one, edits
  // couldn't tell them apart.
  const idProblem = (id: string) =>
    !OverlayElementId.safeParse(id).success
      ? 'Lowercase letters, digits and dashes, starting with a letter'
      : id !== props.selected && props.doc.elements.some((e) => e.id === id)
        ? `Another element is already "${id}"`
        : null

  return (
    <div class="overlay-props">
      <section>
        <h3>Overlay</h3>
        <div class="prop-pair">
          <NumberProp
            label="Width"
            value={props.doc.canvas.width}
            min={1}
            onChange={(width) => set({ canvas: { ...props.doc.canvas, width } })}
          />
          <NumberProp
            label="Height"
            value={props.doc.canvas.height}
            min={1}
            onChange={(height) => set({ canvas: { ...props.doc.canvas, height } })}
          />
        </div>
        <NumberProp
          label="Fade (ms)"
          value={props.doc.fadeMs}
          min={0}
          step={50}
          onChange={(fadeMs) => set({ fadeMs })}
        />
        <Prop label="Hide when paused">
          <span class="prop-inline">
            <input
              type="checkbox"
              checked={props.doc.hideAfterPausedMs !== null}
              onChange={(e) =>
                set({ hideAfterPausedMs: e.currentTarget.checked ? 5 * 60_000 : null })
              }
            />
            <Show when={props.doc.hideAfterPausedMs !== null}>
              after
              <input
                type="number"
                min="1"
                step="1"
                value={(props.doc.hideAfterPausedMs ?? 0) / 60_000}
                onInput={(e) => {
                  const minutes = e.currentTarget.valueAsNumber
                  if (minutes > 0) set({ hideAfterPausedMs: Math.round(minutes * 60_000) })
                }}
              />
              min
            </Show>
          </span>
        </Prop>

        <h3>Elements</h3>
        {/* Front first, as in a layer list; the document paints back first. */}
        <ul class="list element-list">
          <For each={[...props.doc.elements].reverse()}>
            {(e) => (
              <li classList={{ selected: e.id === props.selected }}>
                <button type="button" class="element-name" onClick={() => props.onSelect(e.id)}>
                  <span class="title">{e.id}</span>
                  <span class="artist">{TYPE_LABEL[e.type]}</span>
                </button>
                <span class="actions">
                  <button
                    type="button"
                    class="quiet"
                    title="Bring forward"
                    onClick={() => props.onChange(moveElement(props.doc, e.id, 1))}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    class="quiet"
                    title="Send backward"
                    onClick={() => props.onChange(moveElement(props.doc, e.id, -1))}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    class="quiet"
                    title="Remove"
                    onClick={() => {
                      props.onChange(removeElement(props.doc, e.id))
                      if (e.id === props.selected) props.onSelect(null)
                    }}
                  >
                    ✕
                  </button>
                </span>
              </li>
            )}
          </For>
        </ul>
        <div class="button-row">
          <select
            value={adding()}
            onChange={(e) => setAdding(e.currentTarget.value as ElementType)}
          >
            <For each={ELEMENT_TYPES}>{(t) => <option value={t.type}>{t.label}</option>}</For>
          </select>
          <button
            type="button"
            onClick={() => {
              const added = addElement(props.doc, adding())
              props.onChange(added.doc)
              props.onSelect(added.id)
            }}
          >
            Add
          </button>
        </div>
      </section>

      <section>
        <Show
          when={element()}
          fallback={<p class="empty">Select an element, here or in the preview.</p>}
        >
          {(e) => (
            <>
              <h3>{TYPE_LABEL[e().type]}</h3>
              <TextProp
                label="Id"
                value={e().id}
                title="Its class in OBS Custom CSS is hl-<id>"
                commit
                validate={idProblem}
                onChange={(id) => setElement({ id })}
              />
              <div class="prop-pair">
                <NumberProp label="X" value={e().x} onChange={(x) => setElement({ x })} />
                <NumberProp label="Y" value={e().y} onChange={(y) => setElement({ y })} />
              </div>
              <div class="prop-pair">
                <NumberProp
                  label="Width"
                  value={e().width}
                  min={1}
                  onChange={(width) => setElement({ width })}
                />
                <NumberProp
                  label="Height"
                  value={e().height}
                  min={1}
                  onChange={(height) => setElement({ height })}
                />
              </div>
              <RangeProp
                label="Opacity"
                value={e().opacity}
                onChange={(opacity) => setElement({ opacity })}
              />
              <ElementProps element={e()} onChange={setElement} />
            </>
          )}
        </Show>
      </section>
    </div>
  )
}

/** The fields particular to each kind of element. */
function ElementProps(props: {
  element: OverlayElement
  onChange: (changes: Partial<OverlayElement>) => void
}) {
  return (
    <Switch>
      <Match when={props.element.type === 'rect' && props.element}>
        {(e) => (
          <>
            <ColorProp
              label="Fill"
              value={e().fill}
              onChange={(fill) => props.onChange({ fill })}
            />
            <NumberProp
              label="Corner radius"
              value={e().radius}
              min={0}
              onChange={(radius) => props.onChange({ radius })}
            />
          </>
        )}
      </Match>
      <Match when={props.element.type === 'art' && props.element}>
        {(e) => (
          <>
            <NumberProp
              label="Corner radius"
              value={e().radius}
              min={0}
              onChange={(radius) => props.onChange({ radius })}
            />
            <ColorProp
              label="No art"
              value={e().placeholder}
              onChange={(placeholder) => props.onChange({ placeholder })}
            />
            <ColorProp
              label="Paused shade"
              value={e().pausedShade}
              onChange={(pausedShade) => props.onChange({ pausedShade })}
            />
            <ColorProp
              label="Pause sign"
              value={e().pauseSign}
              nullable
              onChange={(pauseSign) => props.onChange({ pauseSign })}
            />
          </>
        )}
      </Match>
      <Match when={props.element.type === 'text' && props.element}>
        {(e) => (
          <>
            <TextProp
              label="Text"
              value={e().text}
              title="{title}, {artists} and {album} are filled in"
              onChange={(text) => props.onChange({ text })}
            />
            <p class="prop-hint">
              <code>{'{title}'}</code>, <code>{'{artists}'}</code> and <code>{'{album}'}</code> are
              filled in.
            </p>
            <TextProp
              label="Font"
              value={e().font}
              list="overlay-fonts"
              commit
              onChange={(font) => props.onChange({ font })}
            />
            <datalist id="overlay-fonts">
              <For each={fonts()}>{(f) => <option value={f} />}</For>
            </datalist>
            <div class="prop-pair">
              <NumberProp
                label="Size"
                value={e().size}
                min={1}
                step={0.5}
                onChange={(size) => props.onChange({ size })}
              />
              <Prop label="Weight">
                <select
                  value={e().weight}
                  onChange={(ev) => props.onChange({ weight: Number(ev.currentTarget.value) })}
                >
                  <For each={[100, 200, 300, 400, 500, 600, 700, 800, 900]}>
                    {(w) => <option value={w}>{w}</option>}
                  </For>
                </select>
              </Prop>
            </div>
            <ColorProp
              label="Colour"
              value={e().color}
              onChange={(color) => props.onChange({ color })}
            />
            <Prop label="Align">
              <select
                value={e().align}
                onChange={(ev) =>
                  props.onChange({ align: ev.currentTarget.value as 'left' | 'center' | 'right' })
                }
              >
                <option value="left">Left</option>
                <option value="center">Centre</option>
                <option value="right">Right</option>
              </select>
            </Prop>
            <TextProp
              label="Shadow"
              value={e().shadow ?? ''}
              placeholder="None"
              title="A CSS text-shadow, e.g. 0 1px 3px rgb(0 0 0 / 0.6)"
              commit
              onChange={(shadow) => props.onChange({ shadow: shadow.trim() || null })}
            />
            <RangeProp
              label="Shrink to fit"
              value={e().minScale}
              min={0.3}
              title="A long line shrinks down to this share of its size before it's cut short"
              onChange={(minScale) => props.onChange({ minScale })}
            />
          </>
        )}
      </Match>
      <Match when={props.element.type === 'progress' && props.element}>
        {(e) => (
          <>
            <ColorProp
              label="Played"
              value={e().fill}
              onChange={(fill) => props.onChange({ fill })}
            />
            <ColorProp
              label="Paused"
              value={e().pausedFill}
              onChange={(pausedFill) => props.onChange({ pausedFill })}
            />
            <ColorProp
              label="Track"
              value={e().track}
              onChange={(track) => props.onChange({ track })}
            />
            <ColorProp
              label="Edge"
              value={e().edge}
              nullable
              onChange={(edge) => props.onChange({ edge })}
            />
          </>
        )}
      </Match>
    </Switch>
  )
}

function Prop(props: { label: string; title?: string; children: JSX.Element }) {
  return (
    <label class="prop" title={props.title}>
      <span>{props.label}</span>
      {props.children}
    </label>
  )
}

function NumberProp(props: {
  label: string
  value: number
  min?: number
  step?: number
  onChange: (value: number) => void
}) {
  return (
    <Prop label={props.label}>
      <input
        type="number"
        value={props.value}
        min={props.min}
        step={props.step ?? 1}
        onInput={(e) => {
          // Mid-edit (empty, or just "-") isn't a number yet: wait for one.
          const n = e.currentTarget.valueAsNumber
          if (Number.isFinite(n) && (props.min === undefined || n >= props.min)) props.onChange(n)
        }}
      />
    </Prop>
  )
}

/**
 * Updates as you type, or with `commit` once you leave the field or press Enter.
 * A committed value `validate` objects to isn't applied: the field reverts and says why.
 */
function TextProp(props: {
  label: string
  value: string
  title?: string
  placeholder?: string
  list?: string
  commit?: boolean
  validate?: (value: string) => string | null
  onChange: (value: string) => void
}) {
  const [problem, setProblem] = createSignal<string | null>(null)
  return (
    <>
      <Prop label={props.label} title={props.title}>
        <input
          value={props.value}
          list={props.list}
          placeholder={props.placeholder}
          spellcheck={false}
          onInput={(e) => !props.commit && props.onChange(e.currentTarget.value)}
          onChange={(e) => {
            if (!props.commit) return
            const value = e.currentTarget.value
            const problem = props.validate?.(value) ?? null
            setProblem(problem)
            if (problem) e.currentTarget.value = props.value
            else props.onChange(value)
          }}
        />
      </Prop>
      <Show when={problem()}>{(text) => <p class="prop-hint warning">{text()}</p>}</Show>
    </>
  )
}

function RangeProp(props: {
  label: string
  value: number
  min?: number
  title?: string
  onChange: (value: number) => void
}) {
  return (
    <Prop label={props.label} title={props.title}>
      <span class="prop-inline">
        <input
          type="range"
          min={props.min ?? 0}
          max="1"
          step="0.05"
          value={props.value}
          onInput={(e) => props.onChange(e.currentTarget.valueAsNumber)}
        />
        <span class="value">{Math.round(props.value * 100)}%</span>
      </span>
    </Prop>
  )
}

/**
 * A colour as a picker plus alpha, with the CSS value beside them for anything
 * a picker can't show (a gradient, a named colour). `nullable` adds an on/off box.
 */
function ColorProp<N extends boolean = false>(props: {
  label: string
  value: N extends true ? string | null : string
  nullable?: N
  onChange: (value: N extends true ? string | null : string) => void
}) {
  type Value = N extends true ? string | null : string
  const parsed = () => (props.value === null ? null : readColor(props.value))
  // Turning a colour back on brings back the last one.
  // eslint-disable-next-line solid/reactivity -- only the starting value
  let last = props.value ?? '#ffffff'
  const change = (value: string | null) => {
    if (value !== null) last = value
    props.onChange(value as Value)
  }
  return (
    <Prop label={props.label}>
      <span class="prop-inline color-prop">
        <Show when={props.nullable}>
          <input
            type="checkbox"
            title="Show"
            checked={props.value !== null}
            onChange={(e) => change(e.currentTarget.checked ? last : null)}
          />
        </Show>
        <input
          type="color"
          value={parsed()?.hex ?? '#000000'}
          disabled={!parsed()}
          onInput={(e) => change(rgbCss(e.currentTarget.value, parsed()?.alpha ?? 1))}
        />
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          title="Opacity"
          value={parsed()?.alpha ?? 1}
          disabled={!parsed()}
          onInput={(e) => {
            const color = parsed()
            if (color) change(rgbCss(color.hex, e.currentTarget.valueAsNumber))
          }}
        />
        <input
          value={props.value ?? ''}
          disabled={props.value === null}
          spellcheck={false}
          onChange={(e) => change(e.currentTarget.value.trim() || last)}
        />
      </span>
    </Prop>
  )
}
