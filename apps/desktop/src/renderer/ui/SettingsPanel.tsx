import type { ApiToken, Scope } from '@halocline/core'
import { DEFAULT_OVERLAY_ID } from '@halocline/core/overlay'
import { createResource, createSignal, For, onCleanup, Show } from 'solid-js'
import type { OverlayInfo } from '../../shared/ipc'
import { call } from './bridge'
import type { AppState } from './store'

const SCOPES: Scope[] = [
  'read',
  'player:control',
  'queue:add',
  'queue:manage',
  'library:write',
  'admin',
  'overlay',
]

export function SettingsPanel(props: { state: AppState }) {
  const s = () => props.state.settings()
  const patch = (p: Parameters<typeof call<'settings.patch'>>[1]) =>
    void props.state.run(() => call('settings.patch', p))

  return (
    <section class="pane settings">
      <h2>Playback</h2>
      <label>
        <input
          type="checkbox"
          checked={s()?.streamSafeMode ?? false}
          onChange={(e) => patch({ streamSafeMode: e.currentTarget.checked })}
        />
        Stream-safe mode (only songs tagged stream-safe can be queued)
      </label>
      <OutputAndTransitions state={props.state} />
      <Autoplay state={props.state} />
      <AudioAnalysis state={props.state} />
      <YouTubeMusic state={props.state} />
      <LibraryFolders state={props.state} />
      <ObsOverlay state={props.state} />
      <ApiTokens state={props.state} />
    </section>
  )
}

function OutputAndTransitions(props: { state: AppState }) {
  const playback = () => props.state.settings()?.playback
  const output = () => props.state.output()
  const patch = (p: NonNullable<Parameters<typeof call<'settings.patch'>>[1]['playback']>) =>
    void props.state.run(() => call('settings.patch', { playback: p }))
  const seconds = () => (playback()?.crossfadeMs ?? 0) / 1000

  return (
    <>
      <label class="field">
        <span>Output device</span>
        {/* The options are rebuilt whenever the player reports its devices, and a rebuilt
            <select> shows its first option; marking the chosen <option> keeps the choice. */}
        <select onChange={(e) => patch({ outputDeviceId: e.currentTarget.value })}>
          <option value="" selected={!playback()?.outputDeviceId}>
            System default
          </option>
          <For each={output()?.devices}>
            {(d) => (
              <option value={d.deviceId} selected={d.deviceId === playback()?.outputDeviceId}>
                {d.label}
              </option>
            )}
          </For>
          <Show
            when={
              playback()?.outputDeviceId &&
              !output()?.devices.some((d) => d.deviceId === playback()?.outputDeviceId)
            }
          >
            <option value={playback()?.outputDeviceId} selected>
              Disconnected device
            </option>
          </Show>
        </select>
      </label>
      <Show when={output()?.error}>{(error) => <p class="warning">{error()}</p>}</Show>
      <label class="field">
        <span>Crossfade</span>
        <input
          type="range"
          min="0"
          max="12"
          step="0.5"
          value={seconds()}
          onChange={(e) => patch({ crossfadeMs: Math.round(Number(e.currentTarget.value) * 1000) })}
        />
        <span class="value">{seconds() ? `${seconds()} s` : 'Off (gapless)'}</span>
      </label>
      <label>
        <input
          type="checkbox"
          checked={playback()?.gaplessAlbums ?? true}
          disabled={!seconds()}
          onChange={(e) => patch({ gaplessAlbums: e.currentTarget.checked })}
        />
        Play tracks from the same album gapless, without crossfading
      </label>
    </>
  )
}

/** Autoplay (PLAN §7): similar songs when the queue runs low. */
function Autoplay(props: { state: AppState }) {
  const autoplay = () => props.state.settings()?.autoplay
  const patch = (p: NonNullable<Parameters<typeof call<'settings.patch'>>[1]['autoplay']>) =>
    void props.state.run(() => call('settings.patch', { autoplay: p }))
  const number = (value: string, fallback: number) =>
    Number.isFinite(Number(value)) && value !== '' ? Number(value) : fallback

  return (
    <>
      <h2>Autoplay</h2>
      <label>
        <input
          type="checkbox"
          checked={autoplay()?.enabled ?? true}
          onChange={(e) => patch({ enabled: e.currentTarget.checked })}
        />
        Add similar songs when the queue runs low
      </label>
      <label class="field">
        <span>Keep queued</span>
        <input
          type="number"
          min="1"
          max="50"
          value={autoplay()?.minQueueLength ?? 2}
          onChange={(e) => patch({ minQueueLength: Math.round(number(e.currentTarget.value, 2)) })}
        />
        <span class="value">songs</span>
      </label>
      <label class="field">
        <span>Draw from</span>
        <select
          value={autoplay()?.sources ?? 'all'}
          onChange={(e) => patch({ sources: e.currentTarget.value as 'all' | 'library' })}
        >
          <option value="all">Library and YouTube Music</option>
          <option value="library">Library only</option>
        </select>
      </label>
      <label class="field">
        <span>Adventurousness</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={autoplay()?.adventurousness ?? 0.3}
          onChange={(e) => patch({ adventurousness: Number(e.currentTarget.value) })}
        />
        <span class="value">
          {(autoplay()?.adventurousness ?? 0.3) < 0.2
            ? 'Closest match'
            : (autoplay()?.adventurousness ?? 0.3) > 0.7
              ? 'Wide'
              : 'Some variety'}
        </span>
      </label>
      <label class="field">
        <span>Artist gap</span>
        <input
          type="number"
          min="0"
          max="20"
          value={autoplay()?.artistGap ?? 3}
          onChange={(e) => patch({ artistGap: Math.round(number(e.currentTarget.value, 3)) })}
        />
        <span class="value">songs before an artist again</span>
      </label>
      <label class="field">
        <span>Skip recent</span>
        <input
          type="number"
          min="0"
          max="168"
          value={autoplay()?.recentHours ?? 3}
          onChange={(e) => patch({ recentHours: number(e.currentTarget.value, 3) })}
        />
        <span class="value">hours since a song last played</span>
      </label>
      <Show when={props.state.settings()?.streamSafeMode}>
        <p class="empty">Stream-safe mode is on, so autoplay picks only stream-safe songs.</p>
      </Show>
    </>
  )
}

/** Audio analysis for autoplay (PLAN §7). */
function AudioAnalysis(props: { state: AppState }) {
  const status = () => props.state.analysis()
  const enabled = () => props.state.settings()?.analysis.enabled ?? true
  const model = () => status()?.model
  const total = () => (status()?.analyzed ?? 0) + (status()?.pending ?? 0)
  return (
    <>
      <h2>Audio analysis</h2>
      <label>
        <input
          type="checkbox"
          checked={enabled()}
          onChange={(e) =>
            void props.state.run(() =>
              call('settings.patch', { analysis: { enabled: e.currentTarget.checked } }),
            )
          }
        />
        Analyze songs so autoplay can pick by tempo, key, energy and sound
      </label>
      <label>
        <input
          type="checkbox"
          checked={props.state.settings()?.analysis.duringPlayback ?? false}
          disabled={!enabled()}
          onChange={(e) =>
            void props.state.run(() =>
              call('settings.patch', { analysis: { duringPlayback: e.currentTarget.checked } }),
            )
          }
        />
        Keep analyzing while music plays (uses a CPU core, which could make a stream stutter)
      </label>
      <p class="empty">
        Local files are analyzed in the background, and YouTube Music songs once they've been played
        or prefetched. The first time, a 78 MB sound model (LAION CLAP, Apache-2.0) is downloaded
        from Hugging Face.
      </p>
      <Show when={status()}>
        {(s) => (
          <p>
            {s().analyzed} of {total()} analyzed
            {s().current ? ` · now: ${s().current}` : ''}
            {s().failed ? ` · ${s().failed} couldn't be read` : ''}
            {!enabled() && s().pending ? ' · paused' : ''}
            {enabled() && s().pausedForPlayback && s().pending
              ? ' · waiting for the music to stop'
              : ''}
          </p>
        )}
      </Show>
      <Show when={model()?.state === 'downloading'}>
        <p>Downloading the sound model: {Math.round((model()?.progress ?? 0) * 100)}%</p>
      </Show>
      <Show when={model()?.error}>{(error) => <p class="warning">Sound model: {error()}</p>}</Show>
      <Show when={!model()?.error && status()?.lastError}>
        {(error) => <p class="warning">{error()}</p>}
      </Show>
    </>
  )
}

function YouTubeMusic(props: { state: AppState }) {
  const status = () => props.state.ytm()
  const run = (fn: () => Promise<unknown>) => void props.state.run(fn)
  return (
    <>
      <h2>YouTube Music</h2>
      <div class="button-row">
        <span>
          {status()?.signedIn
            ? `Signed in${status()?.account ? ` as ${status()?.account}` : ''}`
            : 'Not signed in. Search works without an account.'}
        </span>
        <Show
          when={status()?.signedIn}
          fallback={
            <button type="button" onClick={() => run(() => call('ytm.signIn'))}>
              Sign in…
            </button>
          }
        >
          <button type="button" onClick={() => run(() => call('ytm.signOut'))}>
            Sign out
          </button>
        </Show>
      </div>
      <Show when={status()?.signedIn}>
        <YtmChannel state={props.state} />
      </Show>
      <Show when={!status()?.playback}>
        <p class="empty">
          YouTube Music songs can be searched and queued, but not played yet: no playback engine is
          available, so they're skipped.
        </p>
      </Show>
      <Show when={status()?.lastError}>{(error) => <p class="warning">{error()}</p>}</Show>
    </>
  )
}

/**
 * Which of the account's channels YouTube Music is used as: the Google account's
 * own, or a brand channel it manages. Shown only when there's a choice.
 */
function YtmChannel(props: { state: AppState }) {
  // Listed again whenever the YTM status changes (sign-in, a switch).
  const [accounts] = createResource(
    () => props.state.ytm(),
    () => call('ytm.accounts'),
  )
  const chosen = () => {
    const list = accounts() ?? []
    const id = props.state.ytm()?.accountId
    return (list.find((a) => a.id === id) ?? list.find((a) => a.selected))?.id ?? ''
  }
  return (
    <Show when={(accounts()?.length ?? 0) > 1}>
      <label class="field">
        <span>Use as</span>
        <select
          onChange={(e) => {
            const id = e.currentTarget.value
            void props.state.run(() => call('ytm.selectAccount', { id }))
          }}
        >
          <For each={accounts()}>
            {(a) => (
              <option value={a.id} selected={a.id === chosen()}>
                {a.name}
                {a.handle ? ` (${a.handle})` : ''}
              </option>
            )}
          </For>
        </select>
      </label>
    </Show>
  )
}

function LibraryFolders(props: { state: AppState }) {
  const folders = () => props.state.settings()?.library.folders ?? []
  const scanning = () => props.state.scan()?.state === 'scanning'
  const run = (fn: () => Promise<unknown>) => void props.state.run(fn)

  return (
    <>
      <h2>Library folders</h2>
      <ul class="list">
        <For each={folders()} fallback={<li class="empty">No folders yet.</li>}>
          {(folder) => (
            <li>
              <code>{folder}</code>
              <button
                type="button"
                onClick={() => run(() => call('library.removeFolder', { folder }))}
              >
                Remove
              </button>
            </li>
          )}
        </For>
      </ul>
      <div class="button-row">
        <button type="button" onClick={() => run(() => call('library.addFolder'))}>
          Add folder…
        </button>
        <button
          type="button"
          disabled={scanning()}
          onClick={() => run(() => call('library.rescan', {}))}
        >
          Rescan
        </button>
        <button
          type="button"
          disabled={scanning()}
          title="Re-read tags from every file, not just new or changed ones"
          onClick={() => run(() => call('library.rescan', { full: true }))}
        >
          Re-read all tags
        </button>
      </div>
      <p class="empty">
        Folders are watched for changes. Removing a folder makes its tracks unavailable; their tags
        and stream-safe flags are kept in case you add it back.
      </p>
    </>
  )
}

/**
 * Settings → OBS overlays (PLAN §8): each overlay's URL, to paste into a Browser
 * Source. URLs hold the overlay token, so they're copied, never shown.
 */
function ObsOverlay(props: { state: AppState }) {
  const [overlays, { refetch }] = createResource(() => call('overlays.list'))
  // Made, renamed or deleted in the Overlays view, or over the API.
  const off = window.halocline.onEvent((e) => {
    if (e.type === 'overlay.changed' || e.type === 'overlay.deleted') void refetch()
  })
  onCleanup(off)
  /** The overlay whose URL was copied last, and its size; or that every URL changed. */
  const [copied, setCopied] = createSignal<{ name: string; info: OverlayInfo } | 'rotated' | null>(
    null,
  )
  const copy = (id: string, name: string) =>
    props.state.run(async () => setCopied({ name, info: await call('overlay.copy', { id }) }))
  const rotate = () =>
    props.state.run(async () => {
      await call('overlay.rotate')
      setCopied('rotated')
    })

  return (
    <>
      <h2>OBS overlays</h2>
      <p>
        Add a <strong>Browser Source</strong> in OBS and paste an overlay's URL. It shows the
        current song on a transparent background, and hides itself when nothing is playing or an ad
        is on. Make and edit overlays under <strong>Overlays</strong>.
      </p>
      <ul class="list">
        <For each={overlays()}>
          {(o) => (
            <li>
              <span class="track">
                <span class="title">{o.name}</span>
                <span class="artist">
                  {o.document.canvas.width}×{o.document.canvas.height}
                  {o.id === DEFAULT_OVERLAY_ID ? ' · default' : ''}
                </span>
              </span>
              <button type="button" onClick={() => void copy(o.id, o.name)}>
                Copy URL
              </button>
            </li>
          )}
        </For>
      </ul>
      {/* Keyed: it re-renders whenever the value changes, not only when it first appears. */}
      <Show when={copied()} keyed>
        {(value) => (
          <p class="empty">
            {value === 'rotated'
              ? 'Every overlay has a new URL, and the old ones no longer work: copy each one ' +
                "again for its OBS source. The default overlay's is on the clipboard."
              : `Copied ${value.name}'s URL. Set its source to ${value.info.width}×${value.info.height}.`}
          </p>
        )}
      </Show>
      <div class="button-row">
        <button
          type="button"
          title="If a URL leaked: every overlay gets a new one, and OBS sources need them"
          onClick={() => void rotate()}
        >
          New URLs…
        </button>
      </div>
    </>
  )
}

function ApiTokens(props: { state: AppState }) {
  const [tokens, { refetch }] = createResource(() => call('tokens.list'))
  const [apiUrl] = createResource(() => call('api.url'))
  const [name, setName] = createSignal('')
  const [scopes, setScopes] = createSignal<Scope[]>(['read'])
  const [secret, setSecret] = createSignal<string | null>(null)
  const [rateLimit, setRateLimit] = createSignal('')

  const toggle = (scope: Scope, on: boolean) =>
    setScopes((current) => (on ? [...current, scope] : current.filter((x) => x !== scope)))
  const create = () =>
    // eslint-disable-next-line solid/reactivity -- only called from event handlers
    props.state.run(async () => {
      const perMin = Number(rateLimit())
      const created = await call('tokens.create', {
        name: name().trim(),
        scopes: scopes(),
        ...(perMin > 0 && { rateLimitPerMin: Math.round(perMin) }),
      })
      setSecret(created.secret)
      setName('')
      setRateLimit('')
      await refetch()
    })
  const revoke = (token: ApiToken) =>
    props.state.run(async () => {
      await call('tokens.revoke', { id: token.id })
      await refetch()
    })

  return (
    <>
      <h2>API</h2>
      <Show when={apiUrl()} fallback={<p>The API server is not running.</p>}>
        <p class="api-info">
          <span>
            Listening on{' '}
            <a href={apiUrl()!} target="_blank" rel="noreferrer">
              <code>{apiUrl()}</code>
            </a>
          </span>
          <span>
            <a href={`${apiUrl()}/docs`} target="_blank" rel="noreferrer">
              API docs
            </a>{' '}
            (try requests with a token from below)
          </span>
          <span>
            <a href={`${apiUrl()}/openapi.json`} target="_blank" rel="noreferrer">
              OpenAPI document
            </a>
          </span>
        </p>
      </Show>
      <ul class="list">
        <For each={tokens()} fallback={<li class="empty">No tokens yet.</li>}>
          {(t) => (
            <li>
              <span class="track">
                <span class="title">{t.name}</span>
                <span class="artist">
                  {t.scopes.join(', ')}
                  {t.rateLimitPerMin ? ` · ${t.rateLimitPerMin}/min` : ''}
                </span>
              </span>
              <button type="button" onClick={() => void revoke(t)}>
                Revoke
              </button>
            </li>
          )}
        </For>
      </ul>
      <form
        class="token-form"
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <input
          placeholder="Token name, e.g. Stream bot"
          value={name()}
          onInput={(e) => setName(e.currentTarget.value)}
        />
        <input
          type="number"
          min="1"
          placeholder="Requests per minute (optional, e.g. 30 for a chat bot)"
          value={rateLimit()}
          onInput={(e) => setRateLimit(e.currentTarget.value)}
        />
        <div class="scopes">
          <For each={SCOPES}>
            {(scope) => (
              <label>
                <input
                  type="checkbox"
                  checked={scopes().includes(scope)}
                  onChange={(e) => toggle(scope, e.currentTarget.checked)}
                />
                {scope}
              </label>
            )}
          </For>
        </div>
        <button type="submit" disabled={!name().trim() || !scopes().length}>
          Create token
        </button>
      </form>
      <Show when={secret()}>
        <p class="secret">
          Copy this token now; it won't be shown again: <code>{secret()}</code>
        </p>
      </Show>
    </>
  )
}
