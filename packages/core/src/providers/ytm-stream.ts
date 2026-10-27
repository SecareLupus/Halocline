// Portions adapted from the googlevideo examples (https://github.com/LuanRT/googlevideo),
// Copyright (c) 2024 LuanRT, MIT License. See THIRD_PARTY_NOTICES.md.
import { SabrStream } from 'googlevideo/sabr-stream'
import type { SabrFormat } from 'googlevideo/shared-types'
import { buildSabrFormat, EnabledTrackTypes } from 'googlevideo/utils'
import {
  Constants,
  Innertube,
  Platform,
  UniversalCache,
  YTNodes,
  type APIResponseTypes,
  type Types,
} from 'youtubei.js'
import { PoTokenMinter, runInPage, type PageRuntime } from './po-token'

/** Which step of opening a stream failed, for health and `test:stream` (PLAN §4). */
export type StreamStep = 'po_token' | 'player' | 'decipher' | 'sabr'

export class StreamError extends Error {
  constructor(
    readonly step: StreamStep,
    cause: unknown,
  ) {
    super(`${step}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
  }
}

/** One track's audio as it arrives. */
export interface AudioStream {
  mimeType: string
  /** Total bytes, when YouTube says (it normally does). */
  contentLength: number | null
  body: ReadableStream<Uint8Array>
  abort(): void
}

/** Opens YTM audio streams. The track cache is the only caller in the app. */
export interface AudioSource {
  open(videoId: string): Promise<AudioStream>
}

export interface YtmStreamerOptions {
  runtime: PageRuntime
  /** Cookie header from the signed-in session, if any. */
  cookie?: () => Promise<string | undefined>
  /** Where youtubei.js keeps the parsed player script between runs. */
  cacheDir?: string
  fetch?: typeof globalThis.fetch
}

const VIDEO_ID = /^[\w-]{11}$/

/**
 * The direct engine (PLAN §4): youtubei.js player data, a PO token, and SABR
 * streaming via googlevideo. Google's scripts (BotGuard and the player's URL
 * decipher) run in the injected page runtime, never in Node.
 */
export class YtmStreamer implements AudioSource {
  private session: Promise<Innertube> | null = null
  private readonly minter: PoTokenMinter
  private readonly fetch: typeof globalThis.fetch

  constructor(private readonly options: YtmStreamerOptions) {
    this.fetch = options.fetch ?? globalThis.fetch
    this.minter = new PoTokenMinter(options.runtime, this.fetch)
    // youtubei.js extracts the decipher functions from the player script; they
    // run in the page alongside BotGuard. There is one streamer per process.
    Platform.shim.eval = async (data) =>
      (await runInPage(options.runtime, data.output)) as Types.EvalResult
  }

  /** Drops the session and minter, e.g. after signing in or out. */
  refresh(): void {
    this.session = null
    this.minter.reset()
  }

  async open(videoId: string): Promise<AudioStream> {
    if (!VIDEO_ID.test(videoId)) throw new StreamError('player', new Error('Bad video ID'))
    const poToken = await step('po_token', () => this.minter.mint(videoId))
    const yt = await step('player', () => this.innertube())
    const response = await step('player', () => this.playerRequest(yt, videoId))
    const status = response.playability_status?.status
    if (status !== 'OK') {
      const reason = response.playability_status?.reason
      throw new StreamError(
        'player',
        new Error(`Not playable: ${status}${reason ? ` (${reason})` : ''}`),
      )
    }
    const streamingUrl = await step('decipher', () => decipherUrl(yt, response))
    const ustreamerConfig = ustreamerConfigOf(response)
    if (!ustreamerConfig) throw new StreamError('player', new Error('No streaming config'))
    const formats = response.streaming_data?.adaptive_formats.map(buildSabrFormat) ?? []
    const audioFormat = pickAudio(formats)
    if (!audioFormat) throw new StreamError('player', new Error('No audio format'))

    const client = yt.session.context.client
    const sabr = new SabrStream({
      videoId,
      formats,
      serverAbrStreamingUrl: streamingUrl,
      videoPlaybackUstreamerConfig: ustreamerConfig,
      clientInfo: {
        clientName: parseInt(
          Constants.CLIENT_NAME_IDS[client.clientName as keyof typeof Constants.CLIENT_NAME_IDS],
        ),
        clientVersion: client.clientVersion,
      },
      // Sent up front so the first request isn't held back waiting for one.
      poToken: Buffer.from(poToken).toString('base64'),
      fetchFunction: this.fetch,
      callbacks: {
        onMintPoToken: () => this.minter.mint(videoId),
        onReloadPlayerResponse: async (context) => {
          const reloaded = await this.playerRequest(yt, videoId, context)
          const config = ustreamerConfigOf(reloaded)
          if (!config) throw new Error('No streaming config in reloaded player response')
          return {
            serverAbrStreamingUrl: await decipherUrl(yt, reloaded),
            videoPlaybackUstreamerConfig: config,
          }
        },
      },
    })
    try {
      const { audioStream } = sabr.start({
        audioFormat,
        enabledTrackTypes: EnabledTrackTypes.AUDIO_ONLY,
        isPostLiveDvr: false,
      })
      return {
        mimeType: audioFormat.mimeType ?? 'audio/webm',
        contentLength: audioFormat.contentLength ?? null,
        body: audioStream as ReadableStream<Uint8Array>,
        abort: () => void sabr.abort(),
      }
    } catch (err) {
      throw new StreamError('sabr', err)
    }
  }

  private innertube(): Promise<Innertube> {
    this.session ??= (async () => {
      const cookie = await this.options.cookie?.()
      const signedIn = Boolean(cookie && /(?:^|;\s*)(?:__Secure-3PAPISID|SAPISID)=/.test(cookie))
      return Innertube.create({
        fetch: this.fetch,
        cache: new UniversalCache(Boolean(this.options.cacheDir), this.options.cacheDir),
        ...(signedIn && { cookie }),
      })
    })().catch((err: unknown) => {
      this.session = null
      throw err
    })
    return this.session
  }

  private async playerRequest(yt: Innertube, videoId: string, reloadPlaybackContext?: unknown) {
    const endpoint = new YTNodes.NavigationEndpoint({ watchEndpoint: { videoId } })
    return (await endpoint.call(yt.actions, {
      playbackContext: {
        contentPlaybackContext: {
          vis: 0,
          splay: false,
          signatureTimestamp: yt.session.player?.signature_timestamp,
        },
        ...(reloadPlaybackContext !== undefined && { reloadPlaybackContext }),
      },
      contentCheckOk: true,
      racyCheckOk: true,
      client: 'WEB',
      parse: true,
    })) as PlayerResponse
  }
}

type PlayerResponse = APIResponseTypes.IPlayerResponse

async function step<T>(name: StreamStep, work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (err) {
    throw err instanceof StreamError ? err : new StreamError(name, err)
  }
}

async function decipherUrl(yt: Innertube, response: PlayerResponse): Promise<string> {
  const url = response.streaming_data?.server_abr_streaming_url
  if (!url || !yt.session.player) throw new Error('No streaming URL')
  return yt.session.player.decipher(url)
}

function ustreamerConfigOf(response: PlayerResponse): string | undefined {
  return response.player_config?.media_common_config.media_ustreamer_request_config
    ?.video_playback_ustreamer_config
}

/** The best original-language audio, preferring Opus in WebM. */
export function pickAudio(formats: SabrFormat[]): SabrFormat | undefined {
  const audio = formats.filter(
    (f) => f.mimeType?.startsWith('audio/') && !f.isDrc && !f.isDubbed && !f.isDescriptive,
  )
  const score = (f: SabrFormat) => (f.mimeType?.includes('webm') ? 1e9 : 0) + f.bitrate
  return audio.sort((a, b) => score(b) - score(a))[0]
}
