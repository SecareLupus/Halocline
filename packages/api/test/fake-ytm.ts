import type { YtmCatalog } from '@halocline/core'

/** Keeps API tests off the network: YTM search finds nothing. */
export const offlineYtm: YtmCatalog = {
  status: () => ({ signedIn: false, account: null, playback: false, lastError: null }),
  refresh: async () => {},
  searchSongs: async () => [],
  getSong: async () => undefined,
}
