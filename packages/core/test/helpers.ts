import { createCore, type Core, type NewRecording } from '../src'

export function testCore(): Core {
  return createCore({ dbPath: ':memory:' })
}

export function song(core: Core, title: string, extra: Partial<NewRecording> = {}) {
  return core.library.create({ title, artists: ['Test Artist'], inLibrary: true, ...extra })
}
