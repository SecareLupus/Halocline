import type { ApiToken, Scope } from '@halocline/core'
import { createResource, createSignal, For, Show } from 'solid-js'
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
      <label>
        <input
          type="checkbox"
          checked={s()?.autoplay.enabled ?? true}
          onChange={(e) => patch({ autoplay: { enabled: e.currentTarget.checked } })}
        />
        Autoplay similar songs when the queue runs low
      </label>
      <OutputAndTransitions state={props.state} />
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
        <select
          value={playback()?.outputDeviceId ?? ''}
          onChange={(e) => patch({ outputDeviceId: e.currentTarget.value })}
        >
          <option value="">System default</option>
          <For each={output()?.devices}>{(d) => <option value={d.deviceId}>{d.label}</option>}</For>
          <Show
            when={
              playback()?.outputDeviceId &&
              !output()?.devices.some((d) => d.deviceId === playback()?.outputDeviceId)
            }
          >
            <option value={playback()?.outputDeviceId}>Disconnected device</option>
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

/** Settings → Overlay (PLAN §8). The URL holds a token, so it's copied, never shown. */
function ObsOverlay(props: { state: AppState }) {
  const [copied, setCopied] = createSignal<OverlayInfo | null>(null)
  const [rotated, setRotated] = createSignal(false)
  const copy = (rotate: boolean) =>
    props.state.run(async () => {
      setCopied(await call(rotate ? 'overlay.rotate' : 'overlay.copy'))
      setRotated(rotate)
    })

  return (
    <>
      <h2>OBS overlay</h2>
      <p>
        Add a <strong>Browser Source</strong> in OBS and paste the overlay URL. It shows the current
        song with its art and a progress bar on a transparent background, and hides itself when
        nothing is playing or an ad is on.
      </p>
      <div class="button-row">
        <button type="button" onClick={() => void copy(false)}>
          Copy overlay URL
        </button>
        <button
          type="button"
          title="Use if the URL leaked; OBS sources need the new one"
          onClick={() => void copy(true)}
        >
          New URL…
        </button>
      </div>
      <Show when={copied()}>
        {(info) => (
          <p class="empty">
            {rotated() ? 'New URL copied; the old one no longer works. ' : 'Copied. '}
            Recommended source size: {info().width}×{info().height}. Colours, fonts and the bar can
            be restyled in the source's Custom CSS (<code>--hl-text-color</code>,{' '}
            <code>--hl-bar-color</code>, <code>--hl-font</code>, …).
          </p>
        )}
      </Show>
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
      <p>
        <Show when={apiUrl()} fallback="The API server is not running.">
          Listening on <code>{apiUrl()}</code> · OpenAPI document at{' '}
          <code>{apiUrl()}/openapi.json</code>
        </Show>
      </p>
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
