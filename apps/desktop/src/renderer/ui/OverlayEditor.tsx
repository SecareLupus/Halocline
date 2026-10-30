import {
  DEFAULT_OVERLAY_ID,
  OVERLAY_TEMPLATES,
  OverlayDocument,
  type Overlay,
} from '@halocline/core/overlay'
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import type { OverlayInfo } from '../../shared/ipc'
import { BridgeError, call } from './bridge'
import { OverlayPreview } from './OverlayPreview'
import { OverlayProperties } from './OverlayProperties'
import type { AppState } from './store'

/** Edits save this long after the last one, so OBS redraws while you work but not per key. */
const SAVE_AFTER_MS = 400

type SaveStatus = 'saved' | 'saving' | 'invalid' | 'conflict'

/**
 * Overlays (PLAN §8): pick one, edit its document with a live preview, and it
 * saves as you go, so open OBS sources redraw. Saves carry the revision they
 * were made from, so an edit made elsewhere (the API) isn't overwritten.
 */
export function OverlayEditor(props: { state: AppState }) {
  const [overlays, setOverlays] = createSignal<Overlay[]>([])
  const [selectedId, setSelectedId] = createSignal(DEFAULT_OVERLAY_ID)
  const [draft, setDraft] = createSignal<OverlayDocument | null>(null)
  const [element, setElement] = createSignal<string | null>(null)
  const [status, setStatus] = createSignal<SaveStatus>('saved')
  const [issue, setIssue] = createSignal<string | null>(null)
  const [copied, setCopied] = createSignal<OverlayInfo | null>(null)
  const [confirmDelete, setConfirmDelete] = createSignal(false)

  /** The revision each overlay's last load or save left it at. */
  const revisions = new Map<string, number>()
  /** The draft has changes no save has picked up yet. */
  let dirty = false
  let inFlight = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let saving = Promise.resolve()

  const selected = () => overlays().find((o) => o.id === selectedId())

  const replace = (overlay: Overlay) =>
    setOverlays((list) =>
      list.some((o) => o.id === overlay.id)
        ? list.map((o) => (o.id === overlay.id ? overlay : o))
        : [...list, overlay],
    )

  const load = (overlay: Overlay) => {
    revisions.set(overlay.id, overlay.revision)
    dirty = false
    setDraft(overlay.document)
    setStatus('saved')
    setIssue(null)
  }

  const select = (id: string) => {
    void save()
    setSelectedId(id)
    setElement(null)
    setCopied(null)
    setConfirmDelete(false)
    const overlay = selected()
    if (overlay) load(overlay)
  }

  /** Where a validation issue is, named by element id rather than index. */
  const describe = (doc: OverlayDocument, path: PropertyKey[], message: string) => {
    const [first, index, ...rest] = path
    const where =
      first === 'elements' && typeof index === 'number'
        ? [doc.elements[index]?.id ?? `element ${index + 1}`, ...rest].join(' › ')
        : path.join(' › ')
    return where ? `${where}: ${message}` : message
  }

  const edit = (next: OverlayDocument) => {
    setDraft(next)
    dirty = true
    clearTimeout(timer)
    const check = OverlayDocument.safeParse(next)
    if (!check.success) {
      const first = check.error.issues[0]!
      setStatus('invalid')
      setIssue(describe(next, first.path, first.message))
      return
    }
    setIssue(null)
    setStatus('saving')
    timer = setTimeout(() => void save(), SAVE_AFTER_MS)
  }

  /**
   * Saves pending edits now, with a rename if given. Saves run one at a time, in
   * order, each from the revision the last one left.
   */
  const save = (name?: string) => {
    clearTimeout(timer)
    const id = selectedId()
    const doc = draft()
    const withDocument = dirty && doc !== null && status() === 'saving'
    if (!withDocument && name === undefined) return saving
    const changes = { ...(name !== undefined && { name }), ...(withDocument && { document: doc }) }
    if (withDocument) dirty = false
    inFlight++
    saving = saving.then(async () => {
      try {
        const saved = await call('overlays.update', { id, changes, revision: revisions.get(id) })
        revisions.set(id, saved.revision)
        replace(saved)
        if (id === selectedId() && !dirty) setStatus('saved')
      } catch (err) {
        if (withDocument) dirty = true
        if (err instanceof BridgeError && err.type === 'revision_mismatch') setStatus('conflict')
        else {
          setStatus('invalid')
          setIssue(err instanceof Error ? err.message : String(err))
        }
      } finally {
        inFlight--
      }
    })
    return saving
  }

  const reload = () =>
    // eslint-disable-next-line solid/reactivity -- only called from event handlers
    props.state.run(async () => {
      load(await call('overlays.get', { id: selectedId() }))
    })

  onMount(() => {
    // eslint-disable-next-line solid/reactivity -- runs once, on mount
    void props.state.run(async () => {
      const list = await call('overlays.list')
      setOverlays(list)
      const first = list.find((o) => o.id === selectedId()) ?? list[0]
      if (first) {
        setSelectedId(first.id)
        load(first)
      }
    })
  })

  // Changes from elsewhere: another editor, or a bot over the API.
  // eslint-disable-next-line solid/reactivity -- reads signals as each event arrives
  const off = window.halocline.onEvent((event) => {
    if (event.type === 'overlay.changed') {
      const overlay = event.data
      replace(overlay)
      const known = revisions.get(overlay.id) ?? 0
      // Our own saves come back as events too; their responses update the revision.
      if (overlay.id === selectedId() && !dirty && !inFlight && overlay.revision > known) {
        load(overlay)
      }
    } else if (event.type === 'overlay.deleted') {
      setOverlays((list) => list.filter((o) => o.id !== event.data.id))
      if (event.data.id === selectedId()) select(DEFAULT_OVERLAY_ID)
    }
  })
  onCleanup(() => {
    off()
    void save()
  })

  // New overlays start from a template.
  const [template, setTemplate] = createSignal(OVERLAY_TEMPLATES[0]!.id)
  const [newName, setNewName] = createSignal('')
  const create = () =>
    // eslint-disable-next-line solid/reactivity -- only called from event handlers
    props.state.run(async () => {
      const from = OVERLAY_TEMPLATES.find((t) => t.id === template())!
      const created = await call('overlays.create', {
        name: newName().trim() || from.name,
        document: from.document,
      })
      replace(created)
      setNewName('')
      select(created.id)
    })

  const copy = () =>
    // eslint-disable-next-line solid/reactivity -- only called from event handlers
    props.state.run(async () => {
      await save()
      setCopied(await call('overlay.copy', { id: selectedId() }))
    })

  // Deleting asks for a second click instead of a dialog, as clearing history does.
  let confirmTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(confirmTimer))
  const remove = () => {
    if (!confirmDelete()) {
      setConfirmDelete(true)
      confirmTimer = setTimeout(() => setConfirmDelete(false), 4000)
      return
    }
    clearTimeout(confirmTimer)
    setConfirmDelete(false)
    const id = selectedId()
    clearTimeout(timer)
    dirty = false
    void props.state.run(() => call('overlays.delete', { id }))
  }

  const statusLabel = () =>
    ({
      saved: 'Saved',
      saving: 'Saving…',
      invalid: 'Not saved',
      conflict: 'Changed elsewhere',
    })[status()]

  return (
    <section class="pane overlays">
      <div class="pane-header">
        <h2>Overlays</h2>
        <span class="save-status" classList={{ warning: status() === 'invalid' }}>
          {statusLabel()}
        </span>
      </div>
      <div class="overlay-editor">
        <aside class="overlay-list">
          <ul class="list">
            <For each={overlays()}>
              {(o) => (
                <li classList={{ selected: o.id === selectedId() }}>
                  <button type="button" class="element-name" onClick={() => select(o.id)}>
                    <span class="title">{o.name}</span>
                    <span class="artist">
                      {o.document.canvas.width}×{o.document.canvas.height}
                      {o.id === DEFAULT_OVERLAY_ID ? ' · default' : ''}
                    </span>
                  </button>
                </li>
              )}
            </For>
          </ul>
          <form
            class="new-overlay"
            onSubmit={(e) => {
              e.preventDefault()
              void create()
            }}
          >
            <h3>New overlay</h3>
            <select value={template()} onChange={(e) => setTemplate(e.currentTarget.value)}>
              <For each={OVERLAY_TEMPLATES}>{(t) => <option value={t.id}>{t.name}</option>}</For>
            </select>
            <p class="prop-hint">
              {OVERLAY_TEMPLATES.find((t) => t.id === template())?.description}
            </p>
            <input
              placeholder="Name (optional)"
              value={newName()}
              onInput={(e) => setNewName(e.currentTarget.value)}
            />
            <button type="submit">Create</button>
          </form>
        </aside>

        <Show when={draft()}>
          {(doc) => (
            <div class="overlay-main">
              <div class="overlay-toolbar">
                <input
                  class="overlay-name"
                  aria-label="Overlay name"
                  value={selected()?.name ?? ''}
                  onChange={(e) => {
                    const name = e.currentTarget.value.trim()
                    if (name) void save(name)
                  }}
                />
                <button type="button" onClick={() => void copy()}>
                  Copy OBS URL
                </button>
                <Show when={selectedId() !== DEFAULT_OVERLAY_ID}>
                  <button type="button" onClick={remove}>
                    {confirmDelete() ? 'Click again to delete' : 'Delete'}
                  </button>
                </Show>
              </div>
              <Show when={copied()}>
                {(info) => (
                  <p class="empty">
                    Copied. Paste it into a Browser Source and set the source to {info().width}×
                    {info().height}.
                  </p>
                )}
              </Show>
              <Show when={status() === 'conflict'}>
                <p class="warning">
                  This overlay was changed elsewhere since you opened it, so your latest edit wasn't
                  saved.{' '}
                  <button type="button" class="quiet" onClick={() => void reload()}>
                    Load the latest
                  </button>
                </p>
              </Show>
              <Show when={issue()}>{(text) => <p class="warning">{text()}</p>}</Show>
              <OverlayPreview
                doc={doc()}
                player={props.state.player()}
                selected={element()}
                onSelect={setElement}
              />
              <OverlayProperties
                doc={doc()}
                selected={element()}
                onSelect={setElement}
                onChange={edit}
              />
            </div>
          )}
        </Show>
      </div>
    </section>
  )
}
