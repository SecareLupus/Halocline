// Portions adapted from bgutils-js (https://github.com/LuanRT/BgUtils),
// Copyright (c) 2024 LuanRT, MIT License. See THIRD_PARTY_NOTICES.md.
import { base64ToU8, buildURL, getHeaders } from 'bgutils-js/utils'

/**
 * Runs a script in a real browser page on www.youtube.com and resolves with
 * its (structured-clonable) result. The app shell provides this as a sandboxed
 * hidden window, so Google's scripts never run in Node (PLAN §4).
 */
export interface PageRuntime {
  run(code: string): Promise<unknown>
}

/** YouTube's web request key for integrity tokens. */
const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo'
const YOUTUBE_URL = 'https://www.youtube.com/'

/**
 * Runs `body` (the body of an async function) in the page. Errors come back as
 * values because Electron reports page exceptions only as "Script failed".
 */
export async function runInPage(runtime: PageRuntime, body: string): Promise<unknown> {
  const result = (await runtime.run(
    `(async () => { try { return { ok: true, value: await (async () => { ${body}\n})() } }` +
      ` catch (e) { return { ok: false, error: String(e && e.stack || e) } } })()`,
  )) as { ok: boolean; value?: unknown; error?: string } | undefined
  if (!result?.ok) throw new Error(result?.error ?? 'Page script returned nothing')
  return result.value
}

/**
 * Mints Proof of Origin tokens the way the YouTube web player does: the BotGuard
 * challenge from the youtube.com page runs in the page, its snapshot is exchanged
 * for an integrity token, and the minter BotGuard hands back signs content
 * bindings. Mirrors bgutils-js (MIT), which documents the protocol.
 */
export class PoTokenMinter {
  private ready: Promise<number> | null = null

  constructor(
    private readonly runtime: PageRuntime,
    private readonly fetch: typeof globalThis.fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /** Drops the minter, e.g. after signing in or out. The next mint starts over. */
  reset(): void {
    this.ready = null
  }

  async mint(binding: string): Promise<Uint8Array> {
    for (let attempt = 0; ; attempt++) {
      const expiresAt = await this.setUp()
      if (this.now() >= expiresAt) {
        this.ready = null
        continue
      }
      const bytes = await runInPage(
        this.runtime,
        `const mint = globalThis.__haloclineMint
        if (typeof mint !== 'function') return null
        return Array.from(await mint(new TextEncoder().encode(${JSON.stringify(binding)})))`,
      )
      if (Array.isArray(bytes) && bytes.every((b) => typeof b === 'number')) {
        return Uint8Array.from(bytes as number[])
      }
      // The page lost its state (reloaded or crashed); set up again once.
      this.ready = null
      if (attempt > 0) throw new Error('PO token minter is unavailable')
    }
  }

  private setUp(): Promise<number> {
    this.ready ??= this.create().catch((err: unknown) => {
      this.ready = null
      throw err
    })
    return this.ready
  }

  /** Resolves with when the integrity token expires. */
  private async create(): Promise<number> {
    const html = await (
      await this.fetch(YOUTUBE_URL, { headers: { 'accept-language': 'en-US,en;q=0.7' } })
    ).text()
    const ytcfg = html.match(/ytcfg\.set\(({.+?})\);/s)?.[1]
    const attestation = html.match(/window\.ytAtN\(\s*({[\s\S]*?})\s*\)/)?.[1]
    if (!ytcfg || !attestation) throw new Error('No BotGuard challenge on the YouTube page')

    // Both are object literals from YouTube's own page, so they're read in the page.
    const challenge = (await runInPage(
      this.runtime,
      `globalThis.yt = { config_: ${ytcfg} }
      const r = (${attestation}).R
      return (typeof r === 'string' ? JSON.parse(r) : r).bgChallenge`,
    )) as BgChallenge | undefined
    if (!challenge?.program || !challenge.globalName)
      throw new Error('Malformed BotGuard challenge')

    let interpreter =
      challenge.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue
    if (!interpreter) {
      const url = challenge.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue
      if (!url) throw new Error('No BotGuard interpreter in challenge')
      interpreter = await (await this.fetch(`https:${url}`)).text()
    }
    await this.runtime.run(`${interpreter}\n;0`)

    const snapshot = await runInPage(
      this.runtime,
      `const vm = globalThis[${JSON.stringify(challenge.globalName)}]
      if (!vm || !vm.a) throw new Error('BotGuard unavailable')
      const snapshot = await new Promise((resolve, reject) => {
        vm.a(${JSON.stringify(challenge.program)}, (asyncSnapshot) => {
          globalThis.__haloclineSignals = []
          asyncSnapshot(resolve, [undefined, undefined, globalThis.__haloclineSignals, undefined])
        }, true, undefined, () => {}, [[], []])
        setTimeout(() => reject(new Error('BotGuard snapshot timed out')), 10000)
      })
      return snapshot`,
    )
    if (typeof snapshot !== 'string') throw new Error('BotGuard returned no snapshot')

    const response = await this.fetch(buildURL('GenerateIT', true), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify([REQUEST_KEY, snapshot]),
    })
    if (!response.ok) throw new Error(`Integrity token request failed: HTTP ${response.status}`)
    const [integrityToken, ttlSecs, refreshSecs] = (await response.json()) as [
      string | undefined,
      number | undefined,
      number | undefined,
    ]
    if (!integrityToken) throw new Error('No integrity token issued')

    const bytes = JSON.stringify(Array.from(base64ToU8(integrityToken)))
    await runInPage(
      this.runtime,
      `const getMinter = globalThis.__haloclineSignals && globalThis.__haloclineSignals[0]
      if (typeof getMinter !== 'function') throw new Error('BotGuard gave no minter')
      const mint = await getMinter(Uint8Array.from(${bytes}))
      if (typeof mint !== 'function') throw new Error('Minter setup failed')
      globalThis.__haloclineMint = mint`,
    )
    const lifetimeSecs = Math.max(60, (ttlSecs ?? 3600) - (refreshSecs ?? 0))
    return this.now() + lifetimeSecs * 1000
  }
}

interface BgChallenge {
  program?: string
  globalName?: string
  interpreterJavascript?: { privateDoNotAccessOrElseSafeScriptWrappedValue?: string }
  interpreterUrl?: { privateDoNotAccessOrElseTrustedResourceUrlWrappedValue?: string }
}
