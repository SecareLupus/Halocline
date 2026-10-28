import { getKv, setKv, type Db } from '../db'
import type { EventBus } from '../events'
import { Settings, SettingsPatch } from '../schemas'

const KEY = 'settings'

export class SettingsService {
  constructor(
    private readonly db: Db,
    private readonly events: EventBus,
  ) {}

  get(): Settings {
    const stored = getKv(this.db, KEY)
    return Settings.parse(stored ? JSON.parse(stored) : {})
  }

  patch(input: SettingsPatch): Settings {
    const patch = SettingsPatch.parse(input)
    const current = this.get()
    const next = Settings.parse({
      ...current,
      ...patch,
      autoplay: { ...current.autoplay, ...patch.autoplay },
      api: { ...current.api, ...patch.api },
      playback: { ...current.playback, ...patch.playback },
      library: { ...current.library, ...patch.library },
      analysis: { ...current.analysis, ...patch.analysis },
    })
    setKv(this.db, KEY, JSON.stringify(next))
    this.events.publish({ type: 'settings.changed', data: next })
    return next
  }
}
