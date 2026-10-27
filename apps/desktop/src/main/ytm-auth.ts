import { BrowserWindow, session, type Session } from 'electron'

/** The YouTube Music sign-in lives in its own persistent session, apart from the app's. */
export const YTM_PARTITION = 'persist:ytm'
const MUSIC_URL = 'https://music.youtube.com'
const SIGN_IN_URL =
  'https://accounts.google.com/ServiceLogin?service=youtube&continue=' +
  encodeURIComponent(`${MUSIC_URL}/`)

export function ytmSession(): Session {
  return session.fromPartition(YTM_PARTITION)
}

/** Remote Google pages get no permissions (camera, notifications, ...). */
export function lockDownYtmSession(): void {
  const s = ytmSession()
  s.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  s.setPermissionCheckHandler(() => false)
}

/** The music.youtube.com cookie header, if the session has any cookies. */
export async function ytmCookie(): Promise<string | undefined> {
  const cookies = await ytmSession().cookies.get({ url: MUSIC_URL })
  return cookies.length ? cookies.map((c) => `${c.name}=${c.value}`).join('; ') : undefined
}

/** Calls `onChange` (debounced) whenever Google or YouTube cookies change. */
export function watchYtmCookies(onChange: () => void): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  ytmSession().cookies.on('changed', (_event, cookie) => {
    if (!/(^|\.)(google|youtube)\.com$/.test(cookie.domain ?? '')) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(onChange, 1000)
  })
}

/**
 * Opens Google's own sign-in page in a plain browser window on the YTM session.
 * The person signs in there themselves; the window closes once it reaches
 * YouTube Music signed in.
 */
export function openYtmSignIn(parent: BrowserWindow | undefined): BrowserWindow {
  const window = new BrowserWindow({
    width: 480,
    height: 720,
    title: 'Sign in to YouTube Music',
    autoHideMenuBar: true,
    ...(parent && { parent }),
    webPreferences: {
      partition: YTM_PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  // Keep Google's pop-ups (account chooser, 2FA help) in this window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void window.loadURL(url)
    return { action: 'deny' }
  })
  window.webContents.on('did-navigate', (_event, url) => {
    if (!url.startsWith(MUSIC_URL)) return
    void ytmCookie().then((cookie) => {
      if (cookie && /(?:^|;\s*)(?:__Secure-3PAPISID|SAPISID)=/.test(cookie)) window.close()
    })
  })
  void window.loadURL(SIGN_IN_URL)
  return window
}

/** Signs out by clearing everything the YTM session stored. */
export async function signOutYtm(): Promise<void> {
  await ytmSession().clearStorageData()
}
