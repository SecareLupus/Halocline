import { afterEach, describe, expect, it } from 'vitest'
import { SettingsPatch, type Core } from '../src'
import { testCore } from './helpers'

let core: Core
afterEach(() => core.close())

describe('SettingsService', () => {
  it('changes only the fields a patch names, even after the patch is parsed', () => {
    core = testCore()
    core.settings.patch({ autoplay: { minQueueLength: 8, artistGap: 5 } })
    // The IPC and API adapters parse patches before passing them on.
    core.settings.patch(SettingsPatch.parse({ autoplay: { enabled: false } }))
    core.settings.patch(SettingsPatch.parse({ autoplay: { enabled: true } }))
    expect(core.settings.get().autoplay).toMatchObject({
      enabled: true,
      minQueueLength: 8,
      artistGap: 5,
    })
  })

  it('keeps the other fields of every group', () => {
    core = testCore()
    core.settings.patch({ playback: { outputDeviceId: 'obs-sink' } })
    core.settings.patch(SettingsPatch.parse({ playback: { crossfadeMs: 3000 } }))
    expect(core.settings.get().playback).toMatchObject({
      outputDeviceId: 'obs-sink',
      crossfadeMs: 3000,
    })
  })
})
